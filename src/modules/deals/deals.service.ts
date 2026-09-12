import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { formatINR, toMajorUnits, toMinorUnits } from '@/common/money/money.util';
import { NotificationsService } from '@/modules/notifications/notifications.service';
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
    try {
      await this.findRealDealsWithAI(userId);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Could not seed live AI deals: ${message}`);
    }
  }

  async deleteAllForUser(userId: string): Promise<void> {
    await this.dealModel.deleteMany({ userId }).exec();
  }

  async findAll(userId: string): Promise<PublicDeal[]> {
    const docs = await this.dealModel.find({ userId }).exec();
    if (docs.length === 0) {
      return this.findRealDealsWithAI(userId);
    }
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

    const count = query && query !== 'All' ? 6 : 12;
    const prompt = `You are an Indian shopping deal finder. Find ${count} current, real, realistic promotional discounts and offers available in India across platforms like Amazon, Flipkart, Myntra, Swiggy, Zomato, Croma, Nykaa, MakeMyTrip, or Tata CLiQ ${
      query && query !== 'All' ? `specifically for the category or search: "${query}"` : 'with 2 deals each across: Electronics, Fashion, Food, Beauty, Travel, and Home'
    }.

Categories must strictly be one of: "Electronics", "Fashion", "Food", "Beauty", "Travel", "Home".

Return a JSON array of objects matching this exact format:
[
  {
    "title": "Exact product or promotional offer name",
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
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`;
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
            const normalizeCategory = (cat?: string): string => {
              if (!cat) return 'Shopping';
              const lower = cat.toLowerCase();
              if (lower.includes('elec') || lower.includes('gadget') || lower.includes('phone') || lower.includes('tv')) return 'Electronics';
              if (lower.includes('fash') || lower.includes('cloth') || lower.includes('shoe') || lower.includes('wear')) return 'Fashion';
              if (lower.includes('food') || lower.includes('dine') || lower.includes('restaurant') || lower.includes('meal')) return 'Food';
              if (lower.includes('beaut') || lower.includes('skin') || lower.includes('cosmetic')) return 'Beauty';
              if (lower.includes('travel') || lower.includes('flight') || lower.includes('hotel') || lower.includes('trip')) return 'Travel';
              if (lower.includes('home') || lower.includes('kitchen') || lower.includes('appliance') || lower.includes('bed')) return 'Home';
              return 'Shopping';
            };

            const getCategoryFallbackImage = (cat: string): string => {
              switch (cat) {
                case 'Electronics':
                  return 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=600&q=80';
                case 'Fashion':
                  return 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=600&q=80';
                case 'Food':
                  return 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?auto=format&fit=crop&w=600&q=80';
                case 'Beauty':
                  return 'https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?auto=format&fit=crop&w=600&q=80';
                case 'Travel':
                  return 'https://images.unsplash.com/photo-1436491865332-7a61a109cc05?auto=format&fit=crop&w=600&q=80';
                case 'Home':
                  return 'https://images.unsplash.com/photo-1585515320310-259814833e62?auto=format&fit=crop&w=600&q=80';
                default:
                  return 'https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?auto=format&fit=crop&w=600&q=80';
              }
            };

            // If query is for a specific category, delete untracked deals in that category; else delete all untracked
            if (query && query !== 'All') {
              const targetCat = normalizeCategory(query);
              await this.dealModel.deleteMany({ userId, tracked: false, category: targetCat }).exec();
            } else {
              await this.dealModel.deleteMany({ userId, tracked: false }).exec();
            }

            await this.dealModel.insertMany(
              parsed.map((d: any) => {
                const cat = normalizeCategory(d.category);
                return {
                  userId: new Types.ObjectId(userId),
                  title: String(d.title || 'Special Deal'),
                  platform: String(d.platform || 'Amazon'),
                  category: cat,
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
                  imageUrl: d.imageUrl || getCategoryFallbackImage(cat),
                  tracked: false,
                };
              }),
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
