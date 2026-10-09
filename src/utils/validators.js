export function isValidHttpUrl(value) {
  if (!value || !String(value).trim()) {
    return true;
  }

  try {
    const parsed = new URL(String(value));
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

export function validateAnnouncementInput({ title, content, imageUrl, footer }) {
  const errors = [];
  const cleanTitle = String(title ?? '');
  const cleanContent = String(content ?? '');
  const cleanImageUrl = String(imageUrl ?? '').trim();
  const cleanFooter = String(footer ?? '');

  if (cleanTitle.length > 256) {
    errors.push('Tiêu đề tối đa 256 ký tự.');
  }

  if (!cleanContent.trim()) {
    errors.push('Nội dung không được để trống.');
  }

  if (cleanContent.length > 4000) {
    errors.push('Nội dung tối đa 4000 ký tự.');
  }

  if (cleanImageUrl.length > 4000) {
    errors.push('URL ảnh tối đa 4000 ký tự.');
  } else if (cleanImageUrl && !isValidHttpUrl(cleanImageUrl)) {
    errors.push('URL hình ảnh không hợp lệ.');
  }

  if (cleanFooter.length > 2048) {
    errors.push('Chân trang tối đa 2048 ký tự.');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
