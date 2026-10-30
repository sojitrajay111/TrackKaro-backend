import { Matches } from 'class-validator';

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** GET /tasks?from=YYYY-MM-DD&to=YYYY-MM-DD (dates are compared as text, so the format matters). */
export class QueryTasksDto {
  @Matches(DATE_KEY, { message: 'from must be YYYY-MM-DD' })
  from!: string;

  @Matches(DATE_KEY, { message: 'to must be YYYY-MM-DD' })
  to!: string;
}
