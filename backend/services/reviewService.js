const { prisma } = require('../config/prisma');

const EMPTY_DISTRIBUTION = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };

const serializeReview = (r) => {
  if (!r) return null;
  return {
    _id: r.id,
    id: r.id,
    product: r.productId,
    user: r.user
      ? { _id: r.user.id, id: r.user.id, name: r.user.name, avatar: r.user.avatar ?? undefined }
      : r.userId,
    rating: r.rating,
    title: r.title ?? undefined,
    body: r.body ?? undefined,
    images: r.images || [],
    isVerifiedPurchase: r.isVerifiedPurchase,
    helpfulVotes: r.helpfulVotes,
    reportCount: r.reportCount,
    isApproved: r.isApproved,
    sellerReply: r.sellerReplyBody ? { body: r.sellerReplyBody, repliedAt: r.sellerRepliedAt } : undefined,
    orderId: r.orderId ?? undefined,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
};

// Recompute a product's rating aggregate from its approved reviews (replaces the
// Mongoose post-save/post-deleteOne hooks).
const recomputeProductRating = async (productId, client = prisma) => {
  const grouped = await client.review.groupBy({
    by: ['rating'],
    where: { productId, isApproved: true },
    _count: { rating: true },
  });

  const distribution = { ...EMPTY_DISTRIBUTION };
  let count = 0;
  let sum = 0;
  for (const g of grouped) {
    const n = g._count.rating;
    distribution[String(g.rating)] = n;
    count += n;
    sum += g.rating * n;
  }
  const average = count ? Math.round((sum / count) * 10) / 10 : 0;

  await client.product.update({
    where: { id: productId },
    data: { ratingAverage: average, ratingCount: count, ratingDistribution: distribution },
  });

  return { average, count, distribution };
};

const REVIEW_USER_SELECT = { select: { id: true, name: true, avatar: true } };

module.exports = { serializeReview, recomputeProductRating, REVIEW_USER_SELECT };
