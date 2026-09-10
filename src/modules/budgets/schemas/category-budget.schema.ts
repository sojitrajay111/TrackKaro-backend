import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type CategoryBudgetDocument = HydratedDocument<CategoryBudget>;

@Schema({ timestamps: true })
export class CategoryBudget {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ required: true })
  category!: string;

  @Prop({ required: true })
  limitMinor!: number;
}

export const CategoryBudgetSchema = SchemaFactory.createForClass(CategoryBudget);

CategoryBudgetSchema.index({ userId: 1, category: 1 }, { unique: true });
