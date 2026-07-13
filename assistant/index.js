// Life Assistant — public surface used by the Electron app (main.js) and CLI.
'use strict';
const { loadConfig } = require('./config');
const { computePeriodStats } = require('./stats');
const { generateReview } = require('./review');
const { validateTransactions, formatReport, hasErrors } = require('./validate');
const { newJournal, newHabitLogs } = require('./scaffold');
const isoweek = require('./isoweek');

module.exports = {
  loadConfig,
  computePeriodStats,
  generateReview,
  validateTransactions, formatReport, hasErrors,
  newJournal, newHabitLogs,
  isoweek,
};
