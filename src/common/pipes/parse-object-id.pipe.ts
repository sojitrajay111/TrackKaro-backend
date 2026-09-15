import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { Types } from 'mongoose';

/**
 * Validates that an `:id` route param is a well-formed Mongo ObjectId before it ever reaches
 * a service. Without this, an invalid id (e.g. a stale client-side demo/sample id like
 * 'sub-netflix') reaches `deleteOne({ _id: id })` / `new Types.ObjectId(id)` and throws an
 * uncaught CastError — surfacing as a raw 500 instead of a clean 400/404.
 */
@Injectable()
export class ParseObjectIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException(`"${value}" is not a valid id.`);
    }
    return value;
  }
}
