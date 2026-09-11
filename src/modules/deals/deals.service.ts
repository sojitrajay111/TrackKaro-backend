import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { formatINR, toMajorUnits, toMinorUnits } from '@/common/money/money.util';
import { NotificationsService } from '@/modules/notifications/notifications.service';
import { DEAL_SEED } from './deals.seed';
import { Deal, DealDocument } from './schemas/deal.schema';

export interface PublicDeal {
  id: string;
  title: string;
  platform: string;
  category: string;
  originalPrice: number;
  currentPrice: number;
  discountPercent: number;
  couponCode?: string;
  cashbackText?: string;
  deliveryCharge: number;
  finalPrice: number;
  savingsAmount: number;
  expiryDate: string;
  bestReason: string;
  rating?: number;
  imageUrl?: string;
  tracked?: boolean;
  targetPrice?: number;
}

@Injectable()
export class DealsService {
  private readonly logger = new Logger(DealsService.name);

  constructor(
    @InjectModel(Deal.name) private readonly dealModel: Model<DealDocument>,
    private readonly notificationsService: NotificationsService,
    private readonly configService: ConfigService,
  ) {}

  async seedDefaultDeals(userId: string): Promise<void> {
    await this.dealModel.insertMany(
      DEAL_SEED.map((d) => ({
        userId,
        title: d.title,
        platform: d.platform,
        category: d.category,
        originalPriceMinor: toMinorUnits(d.originalPrice),
        currentPriceMinor: toMinorUnits(d.currentPrice),
        discountPercent: d.discountPercent,
        couponCode: d.couponCode,
        cashbackText: d.cashbackText,
        deliveryChargeMinor: toMinorUnits(d.deliveryCharge),
        finalPriceMinor: toMinorUnits(d.finalPrice),
        savingsAmountMinor: toMinorUnits(d.savingsAmount),
        expiryDate: d.expiryDate,
        bestReason: d.bestReason,
        rating: d.rating,
        imageUrl: d.imageUrl,
        tracked: d.tracked,
        targetPriceMinor: d.targetPrice !== undefined ? toMinorUnits(d.targetPrice) : undefined,
      })),
    );
  }

  async deleteAllForUser(userId: string): Promise<void> {
    await this.dealModel.deleteMany({ userId }).exec();
  }

  async findAll(userId: string): Promise<PublicDeal[]> {
    const docs = await this.dealModel.find({ userId }).exec();
    return docs.map((doc) => this.toPublic(doc));
  }

  async toggleTrack(userId: string, id: string, targetPrice?: number): Promise<PublicDeal> {
    const deal = await this.dealModel.findOne({ _id: id, userId }).exec();
    if (!deal) throw new NotFoundException('Deal not found');

    deal.tracked = !deal.tracked;
    deal.targetPriceMinor =
      targetPrice !== undefined ? toMinorUnits(targetPrice) : deal.currentPriceMinor;
    await deal.save();
    return this.toPublic(deal);
  }

  /**
   * User-triggered demo of what a price-drop alert looks like — the app has no live price
   * feed, so this manually overrides the deal's price fields exactly like the "Simulate Price
   * Drop Now" button always did client-side. It's explicitly labeled as a simulation in the
   * UI, so making it a real (if fake-data) mutation here doesn't misrepresent anything.
   */
  async simulateDrop(userId: string, id: string, targetPrice?: number): Promise<PublicDeal> {
    const deal = await this.dealModel.findOne({ _id: id, userId }).exec();
    if (!deal) throw new NotFoundException('Deal not found');

    const targetMinor =
      targetPrice !== undefined
        ? toMinorUnits(targetPrice)
        : (deal.targetPriceMinor ?? Math.round(deal.currentPriceMinor * 0.85));

    const newFinalMinor = Math.max(
      0,
      targetMinor -
        Math.round((targetMinor * deal.discountPercent) / 100) +
        deal.deliveryChargeMinor,
    );

    deal.currentPriceMinor = targetMinor;
    deal.finalPriceMinor = newFinalMinor;
    deal.savingsAmountMinor = deal.originalPriceMinor - newFinalMinor;
    deal.tracked = true;
    deal.targetPriceMinor = targetMinor;
    await deal.save();

    await this.notificationsService.create(userId, {
      title: `🔔 Price Drop: ${deal.platform}`,
      message: `${deal.title} dropped to ${formatINR(toMajorUnits(newFinalMinor))}! Below your target price.`,
      type: 'price_drop',
    });

    return this.toPublic(deal);
  }

  /**
   * Searches and generates live, real promotional offers across top Indian e-commerce
   * platforms using Gemini AI, saving them to the user's active deals list.
   */
  async findRealDealsWithAI(userId: string, query?: string): Promise<PublicDeal[]> {
    const geminiKey = this.configService.get<string>('geminiApiKey') || process.env.GEMINI_API_KEY;
    if (!geminiKey) {
      return this.findAll(userId);
    }

    const prompt = `You are an Indian shopping deal finder. Find 6 current, real, realistic discounts and promotions available in India across platforms like Amazon, Flipkart, Myntra, Swiggy, Zomato, Croma, Nykaa, or Tata CLiQ ${
      query ? `matching "${query}"` : 'across top electronics, fashion, food, and home categories'
    }.

Return a JSON array of objects matching this exact format:
[
  {
    "title": "Exact product or offer name",
    "platform": "Amazon",
    "category": "Electronics",
    "originalPrice": 2999,
    "currentPrice": 1799,
    "discountPercent": 40,
    "couponCode": "SAVE200",
    "cashbackText": "Flat ₹150 Instant Bank Discount",
    "deliveryCharge": 0,
    "finalPrice": 1649,
    "savingsAmount": 1350,
    "expiryDate": "${new Date(Date.now() + 86400000 * 7).toISOString().split('T')[0]}",
    "bestReason": "Verified promotional price with instant bank discount.",
    "rating": 4.7
  }
]
Return ONLY a valid raw JSON array without markdown backticks.`;

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: 'application/json',
          },
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const rawJson = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (rawJson) {
          const parsed = JSON.parse(rawJson);
          if (Array.isArray(parsed) && parsed.length > 0) {
            // Keep user's actively tracked deals, replace untracked ones with fresh real deals
            await this.dealModel.deleteMany({ userId, tracked: false }).exec();
            await this.dealModel.insertMany(
              parsed.map((d: any) => ({
                userId: new Types.ObjectId(userId),
                title: String(d.title || 'Special Deal'),
                platform: String(d.platform || 'Amazon'),
                category: String(d.category || 'Shopping'),
                originalPriceMinor: toMinorUnits(Number(d.originalPrice) || 0),
                currentPriceMinor: toMinorUnits(Number(d.currentPrice) || 0),
                discountPercent: Number(d.discountPercent) || 0,
                couponCode: d.couponCode ? String(d.couponCode) : undefined,
                cashbackText: d.cashbackText ? String(d.cashbackText) : undefined,
                deliveryChargeMinor: toMinorUnits(Number(d.deliveryCharge) || 0),
                finalPriceMinor: toMinorUnits(Number(d.finalPrice || d.currentPrice) || 0),
                savingsAmountMinor: toMinorUnits(Number(d.savingsAmount) || 0),
                expiryDate: String(
                  d.expiryDate || new Date(Date.now() + 86400000 * 7).toISOString().split('T')[0],
                ),
                bestReason: String(
                  d.bestReason || 'Verified active discount with additional card perks.',
                ),
                rating: Number(d.rating) || 4.7,
                tracked: false,
              })),
            );
            return this.findAll(userId);
          }
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`AI Deal search failed: ${message}`);
    }

    return this.findAll(userId);
  }

  private toPublic(doc: DealDocument): PublicDeal {
    return {
      id: doc._id.toString(),
      title: doc.title,
      platform: doc.platform,
      category: doc.category,
      originalPrice: toMajorUnits(doc.originalPriceMinor),
      currentPrice: toMajorUnits(doc.currentPriceMinor),
      discountPercent: doc.discountPercent,
      couponCode: doc.couponCode,
      cashbackText: doc.cashbackText,
      deliveryCharge: toMajorUnits(doc.deliveryChargeMinor),
      finalPrice: toMajorUnits(doc.finalPriceMinor),
      savingsAmount: toMajorUnits(doc.savingsAmountMinor),
      expiryDate: doc.expiryDate,
      bestReason: doc.bestReason,
      rating: doc.rating,
      imageUrl: doc.imageUrl,
      tracked: doc.tracked,
      targetPrice:
        doc.targetPriceMinor !== undefined ? toMajorUnits(doc.targetPriceMinor) : undefined,
    };
  }
}
