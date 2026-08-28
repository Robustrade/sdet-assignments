
const { v4: uuidv4 } = require('uuid');

let users = [];

exports.create = (data) => {
  const user = {
    id: uuidv4(),
    ...data
  };

  users.push(user);

  return user;
};

exports.getAll = () => [...users];

exports.getById = (id) => users.find(user => user.id === id);

exports.update = (id, data) => {
  const index = users.findIndex(user => user.id === id);

  if (index === -1) return null;

  users[index] = {
    ...users[index],
    ...data
  };

  return users[index];
};

exports.delete = (id) => {
  const index = users.findIndex(user => user.id === id);

  if (index === -1) return false;

  users.splice(index, 1);

  return true;
};

exports.reset = () => {
  users = [];
};
