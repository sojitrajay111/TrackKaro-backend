import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/**
 * Free-form product attributes (color, size, storage, variant, …). Kept loose rather than a
 * fixed enum set since different categories/providers describe variants differently.
 */
@Schema({ _id: false })
export class ProductAttributes {
  @Prop()
  color?: string;

  @Prop()
  size?: string;

  @Prop()
  storage?: string;

  @Prop()
  variant?: string;
}
export const ProductAttributesSchema = SchemaFactory.createForClass(ProductAttributes);

export type ProductDocument = HydratedDocument<Product>;

/**
 * Canonical, provider-neutral product identity. Deliberately NOT `userId`-scoped, unlike almost
 * every other schema in this codebase — this is shared catalog data (like a product listing),
 * matched/deduplicated across every provider a product appears from, not a personal record. The
 * same real-world product surfaced by two different marketplaces/providers must resolve to one
 * Product row (see `normalizedKey`) with two separate `MerchantOffer`s, never two Products.
 *
 * Only ever written to by `DealIngestionService` from *verified* provider data — the legacy
 * Gemini engine never touches this collection (see CLAUDE.md "Deals provider architecture").
 */
@Schema({ timestamps: true })
export class Product {
  @Prop({ required: true, trim: true })
  title!: string;

  @Prop({ trim: true })
  brand?: string;

  @Prop({ required: true })
  category!: string;

  @Prop({ type: ProductAttributesSchema, default: {} })
  attributes?: ProductAttributes;

  @Prop({ type: [String], default: [] })
  images?: string[];

  /**
   * Deterministic de-duplication key derived from brand + title (see
   * `DealIngestionService#buildNormalizedKey`). A heuristic starting point, not a perfect
   * match — two slightly different titles for the same physical product won't always collide.
   * Revisit with a stronger identifier (GTIN/EAN/MPN) once a real provider supplies one.
   */
  @Prop({ required: true, unique: true, index: true })
  normalizedKey!: string;

  declare createdAt: Date;
}

export const ProductSchema = SchemaFactory.createForClass(Product);
