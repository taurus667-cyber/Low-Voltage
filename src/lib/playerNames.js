export function normalizePlayerName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function validatePlayerFullName(value) {
  const cleanName = String(value || '').trim().replace(/\s+/g, ' ');
  if (!cleanName) {
    return { valid: false, name: '', message: 'Please enter your full name.' };
  }

  if (cleanName.split(' ').filter(Boolean).length < 2) {
    return {
      valid: false,
      name: cleanName,
      message: 'Enter your first and last name, separated by a space.',
    };
  }

  return { valid: true, name: cleanName, message: '' };
}
