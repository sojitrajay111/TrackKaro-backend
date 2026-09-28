import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ScannedBillResult } from '../types';

@Injectable()
export class BillOcrService {
  private readonly logger = new Logger(BillOcrService.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * Scans a receipt/bill image using Gemini 1.5 Flash Vision.
   * Returns structured JSON: merchant, amount, category, date.
   */
  async scanBill(imageBase64: string, mimeType = 'image/jpeg'): Promise<ScannedBillResult> {
    const geminiKey = this.configService.get<string>('geminiApiKey') || process.env.GEMINI_API_KEY;

    // Clean base64 string if it includes data URL prefix
    const cleanBase64 = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;

    if (geminiKey) {
      try {
        const result = await this.callGeminiVision(cleanBase64, mimeType, geminiKey);
        if (result) {
          return result;
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Gemini Vision scan failed, falling back to default draft: ${message}`);
      }
    }

    return {
      merchant: 'Receipt',
      amount: 0,
      category: 'Other',
      date: new Date().toISOString().split('T')[0],
    };
  }

  /**
   * Calls Google Gemini Vision model to extract structured receipt data.
   */
  async callGeminiVision(
    base64Data: string,
    mimeType: string,
    apiKey: string,
  ): Promise<ScannedBillResult | null> {
    const prompt = `Analyze this receipt, bill, or invoice image. Extract the following in strict JSON format:
{
  "merchant": "Vendor or store name",
  "amount": total numeric amount as a number,
  "category": "Food" | "Shopping" | "Bills" | "Fuel" | "Groceries" | "Entertainment" | "Health" | "Other",
  "date": "YYYY-MM-DD" (or today's date if not clearly visible)
}
Return ONLY valid JSON with no markdown wrapping or extra comments.`;

    const candidateModels = ['gemini-2.5-flash', 'gemini-3.6-flash'];
    for (const model of candidateModels) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { text: prompt },
                  {
                    inlineData: {
                      mimeType: mimeType || 'image/jpeg',
                      data: base64Data,
                    },
                  },
                ],
              },
            ],
            generationConfig: {
              temperature: 0.1,
              responseMimeType: 'application/json',
            },
          }),
        });

        if (res.ok) {
          const data = await res.json();
          const rawJson = data?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (rawJson) {
            const parsed = JSON.parse(rawJson);
            return {
              merchant: String(parsed.merchant || 'Merchant Receipt'),
              amount: Number(parsed.amount) || 0,
              category: String(parsed.category || 'Other'),
              date: String(parsed.date || new Date().toISOString().split('T')[0]),
            };
          }
        }
      } catch {
        continue;
      }
    }
    return null;
  }
}
