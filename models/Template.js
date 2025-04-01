const mongoose = require('mongoose');

const templateSchema = new mongoose.Schema({
  title: { type: String, required: true },
  columns: [
    {
      id: String,
      title: String,
      color: String,
      tasks: [
        {
          id: String,
          title: String,
          description: String,
          assignee: String,
          subtasks: [{ title: String, completed: Boolean }],
        },
      ],
    },
  ],
  createdBy: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Template', templateSchema);