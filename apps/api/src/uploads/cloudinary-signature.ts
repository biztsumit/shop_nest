import { createHash } from 'node:crypto';

// Cloudinary's upload signature (https://cloudinary.com/documentation/authentication_signatures):
// every signed field as name=value, sorted by name, joined with "&", then the API secret
// appended with no separator, hashed with SHA-1.
//   { timestamp: "1315060510" } + secret "abcd"  →  sha1("timestamp=1315060510abcd")
// file, cloud_name, resource_type and api_key are sent with the upload but never signed.
export const cloudinarySignature = (fields: Record<string, string>, apiSecret: string): string => {
  const toSign = Object.keys(fields)
    .sort()
    .map((name) => `${name}=${fields[name]}`)
    .join('&');
  return createHash('sha1').update(toSign + apiSecret).digest('hex');
};
