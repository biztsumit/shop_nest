import { z } from "zod";

// Every error the API returns has this ONE shape: "Problem Details", a web standard (RFC 9457).
// The web app reads `detail` to show the user what went wrong, `errors` to put a message
// under each form field, and `requestId` to quote when reporting a problem.
//
//   HTTP/1.1 422
//   Content-Type: application/problem+json
//   {
//     "type": "/problems/validation",
//     "title": "Validation failed",
//     "status": 422,
//     "detail": "2 fields are invalid",
//     "instance": "/api/products",
//     "requestId": "3f2c...",
//     "errors": [{ "path": "price", "message": "Too small: expected number to be >0" }]
//   }
export const fieldErrorSchema = z.object({
  path: z.string(),        // "price", "address.postalCode", "items.2.quantity"
  message: z.string(),
});

export const problemSchema = z.object({
  type: z.string(),        // the KIND of problem: "/problems/validation", or "about:blank" for plain HTTP errors
  title: z.string(),       // short, the same for every problem of this type
  status: z.number().int(),
  detail: z.string(),      // this occurrence, in plain words
  instance: z.string(),    // the path that was requested
  requestId: z.string(),   // also in the X-Request-Id header and in the server's log line
  errors: z.array(fieldErrorSchema).optional(),
});

export type FieldError = z.infer<typeof fieldErrorSchema>;
export type Problem = z.infer<typeof problemSchema>;
