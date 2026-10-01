export const normalizePhone = (input: unknown): string | null => {
  if (typeof input !== "string" || input.length > 30) return null
  const phone = input.trim().replace(/[\s().-]/g, "")
  return /^\+?\d{9,15}$/.test(phone) ? phone : null
}
