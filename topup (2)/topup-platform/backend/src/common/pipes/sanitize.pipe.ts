import { PipeTransform, Injectable, ArgumentMetadata } from '@nestjs/common';
import sanitizeHtml from 'sanitize-html';

/**
 * Global input sanitizer. Strips all HTML/script content from every string
 * field in the incoming body/query/params, recursively. This is defense in
 * depth: Prisma's parameterized queries already prevent SQL injection, but
 * user-controlled strings (playerId, contact phone, nicknames) are still
 * rendered back in admin dashboards and receipts, so they must be XSS-safe
 * at the boundary, not just at render time.
 */
@Injectable()
export class SanitizePipe implements PipeTransform {
  transform(value: any, metadata: ArgumentMetadata) {
    if (metadata.type === 'body' || metadata.type === 'query' || metadata.type === 'param') {
      return this.deepSanitize(value);
    }
    return value;
  }

  private deepSanitize(input: any): any {
    if (typeof input === 'string') {
      return sanitizeHtml(input, { allowedTags: [], allowedAttributes: {} }).trim();
    }
    if (Array.isArray(input)) {
      return input.map((v) => this.deepSanitize(v));
    }
    if (input !== null && typeof input === 'object') {
      const out: Record<string, any> = {};
      for (const key of Object.keys(input)) {
        out[key] = this.deepSanitize(input[key]);
      }
      return out;
    }
    return input;
  }
}
