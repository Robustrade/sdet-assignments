
const service = require('../services/userService');
const { validateCreateUser, validateUpdateUser } = require('../validators/userValidator');
const eventHub = require('../eventHub');

exports.createUser = (req, res) => {
  const { valid, errors } = validateCreateUser(req.body);

  if (!valid) {
    return res.status(400).json({ message: errors.join(', ') });
  }

  const user = service.create(req.body);
  eventHub.emitUserCreated(user);

  res.status(201).json(user);
};

exports.getAllUsers = (req, res) => {
  res.status(200).json(service.getAll());
};

exports.getUserById = (req, res) => {
  const user = service.getById(req.params.id);

  if (!user) {
    return res.status(404).json({ message: 'User not found' });
  }

  res.status(200).json(user);
};

exports.updateUser = (req, res) => {
  const { valid, errors } = validateUpdateUser(req.body);

  if (!valid) {
    return res.status(400).json({ message: errors.join(', ') });
  }

  const user = service.update(req.params.id, req.body);

  if (!user) {
    return res.status(404).json({ message: 'User not found' });
  }

  res.status(200).json(user);
};

exports.deleteUser = (req, res) => {
  const deleted = service.delete(req.params.id);

  if (!deleted) {
    return res.status(404).json({ message: 'User not found' });
  }

  res.status(200).json({ message: 'User deleted successfully' });
};
