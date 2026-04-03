const cloudinary = require('cloudinary').v2;
const { v4: uuidv4 } = require('uuid');

// Support both CLOUDINARY_URL=cloudinary://key:secret@cloud_name
// and the three individual vars (CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET)
if (!process.env.CLOUDINARY_URL) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

/**
 * Upload a buffer to Cloudinary.
 * @param {Buffer} buffer - Image buffer (already processed by Sharp)
 * @param {object} options - Cloudinary upload options (folder, public_id, etc.)
 * @returns {Promise<{url: string, public_id: string}>}
 */
const uploadBuffer = (buffer, options = {}) => {
  const { folder = 'cartly', ...rest } = options;
  const public_id = `${folder}/${uuidv4()}`;

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { resource_type: 'image', public_id, ...rest },
      (error, result) => {
        if (error) return reject(error);
        resolve({ url: result.secure_url, public_id: result.public_id });
      }
    );
    stream.end(buffer);
  });
};

/**
 * Delete an image from Cloudinary by its public_id.
 * Fails silently — a failed delete should never block the main operation.
 * @param {string} public_id
 */
const deleteImage = async (public_id) => {
  if (!public_id) return;
  try {
    await cloudinary.uploader.destroy(public_id);
  } catch (_) {
    // non-fatal
  }
};

/**
 * Verify Cloudinary credentials are valid by pinging the account API.
 * Throws if the credentials are missing or invalid.
 */
const connectCloudinary = async () => {
  const hasUrl = !!process.env.CLOUDINARY_URL;
  const hasVars = process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET;
  if (!hasUrl && !hasVars) {
    throw new Error('Cloudinary credentials are missing — set CLOUDINARY_URL or the three individual vars');
  }
  await cloudinary.api.resources({ max_results: 1 });
};

module.exports = { cloudinary, uploadBuffer, deleteImage, connectCloudinary };
