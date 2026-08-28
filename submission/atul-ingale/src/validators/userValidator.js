const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

exports.validateCreateUser = (data) => {
  const errors = [];

  if (!data || typeof data !== 'object') {
    errors.push('Request body must be a JSON object');
    return { valid: false, errors };
  }

  if (!data.name || typeof data.name !== 'string') {
    errors.push('name is required and must be a string');
  }

  if (!data.email || typeof data.email !== 'string' || !emailRegex.test(data.email)) {
    errors.push('email is required and must be a valid email address');
  }

  if (data.age !== undefined) {
    if (typeof data.age !== 'number' || Number.isNaN(data.age) || data.age < 0) {
      errors.push('age must be a non-negative number');
    }
  }

  return { valid: errors.length === 0, errors };
};

exports.validateUpdateUser = (data) => {
  const errors = [];

  if (!data || typeof data !== 'object' || Object.keys(data).length === 0) {
    errors.push('Request body must include at least one field to update');
    return { valid: false, errors };
  }

  if (data.name !== undefined && typeof data.name !== 'string') {
    errors.push('name must be a string');
  }

  if (data.email !== undefined) {
    if (typeof data.email !== 'string' || !emailRegex.test(data.email)) {
      errors.push('email must be a valid email address');
    }
  }

  if (data.age !== undefined) {
    if (typeof data.age !== 'number' || Number.isNaN(data.age) || data.age < 0) {
      errors.push('age must be a non-negative number');
    }
  }

  return { valid: errors.length === 0, errors };
};
