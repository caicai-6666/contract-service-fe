export function deduplicationInteraction(runStatus, review) {
  if (runStatus === 'duplicate_rejected') return 'rejected'
  const candidates = review?.candidates
  if (!Array.isArray(candidates)) return 'recorded'
  if (runStatus === 'awaiting_deduplication_review' && review.can_continue === true && !review.continued_at && candidates.length > 0) return 'pending'
  if (review.continued_at) return candidates.length === 0 ? 'automatic' : 'confirmed'
  return 'recorded'
}
