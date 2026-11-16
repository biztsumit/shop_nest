import { cloudinarySignature } from './cloudinary-signature.js';

// The worked examples from Cloudinary's documentation: if these match, Cloudinary will accept ours
describe('cloudinarySignature', () => {
  it('signs a timestamp alone', () => {
    expect(cloudinarySignature({ timestamp: '1315060510' }, 'abcd')).toBe('a21ad0f63beb4de2e5575204b79ab90bffb02c10');
  });

  it('sorts the fields by name, whatever order they come in', () => {
    const fields = { timestamp: '1315060510', public_id: 'sample_image', eager: 'w_400,h_300,c_pad|w_260,h_200,c_crop' };
    expect(cloudinarySignature(fields, 'abcd')).toBe('bfd09f95f331f558cbd1320e67aa8d488770583e');
  });
});
