import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendNotification } from '../lib/mailer.mjs';

test('sendNotification: degrades gracefully when SMTP secrets are missing', async () => {
  const result = await sendNotification({ subject: 'test', text: 'body' }, {});
  assert.equal(result.sent, false);
  assert.match(result.reason, /missing SMTP secrets/);
});

test('sendNotification: degrades gracefully when only some secrets are set', async () => {
  const result = await sendNotification({ subject: 'test', text: 'body' }, { SMTP_HOST: 'smtp.example.com' });
  assert.equal(result.sent, false);
});
