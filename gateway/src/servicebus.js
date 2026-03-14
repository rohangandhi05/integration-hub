/**
 * Azure Service Bus publisher.
 * Publishes messages to HR and payroll queues.
 * Falls back gracefully if Azure SB is not configured.
 */

let sbClient = null;

function getSBClient() {
  if (sbClient) return sbClient;
  const connStr = process.env.AZURE_SB_CONNECTION_STRING;
  if (!connStr) return null;
  try {
    const { ServiceBusClient } = require('@azure/service-bus');
    sbClient = new ServiceBusClient(connStr);
    console.log('[servicebus] Client initialized');
    return sbClient;
  } catch (e) {
    console.warn('[servicebus] Failed to initialize:', e.message);
    return null;
  }
}

/**
 * Publish a message to an Azure Service Bus queue.
 * Returns { published: true } on success, { published: false, reason } on failure.
 */
async function publishToQueue(queueName, payload, options = {}) {
  const client = getSBClient();
  if (!client) {
    console.warn(`[servicebus] Not configured — skipping publish to ${queueName}`);
    return { published: false, reason: 'Azure SB not configured' };
  }

  const sender = client.createSender(queueName);
  try {
    const message = {
      body: payload,
      contentType: 'application/json',
      messageId: options.messageId || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      subject: options.subject || queueName,
      applicationProperties: {
        source: 'integration-gateway',
        eventType: options.eventType || 'unknown',
        ...options.properties,
      },
    };
    await sender.sendMessages(message);
    console.log(`[servicebus] Published to ${queueName}: ${message.messageId}`);
    return { published: true, messageId: message.messageId };
  } catch (err) {
    console.error(`[servicebus] Publish failed: ${err.message}`);
    return { published: false, reason: err.message };
  } finally {
    await sender.close();
  }
}

/**
 * Publish an HR employee sync event.
 */
async function publishHREvent(employeeId, xmlPayload, eventType = 'employee.sync') {
  const queueName = process.env.HR_QUEUE_NAME || 'hr-events';
  return publishToQueue(queueName, {
    eventType,
    employeeId,
    xmlPayload,
    timestamp: new Date().toISOString(),
  }, { eventType, subject: `hr.${eventType}` });
}

/**
 * Publish a payroll update event.
 */
async function publishPayrollEvent(employeeId, payload, eventType = 'salary.update') {
  const queueName = process.env.PAYROLL_QUEUE_NAME || 'payroll-events';
  return publishToQueue(queueName, {
    eventType,
    employeeId,
    ...payload,
    timestamp: new Date().toISOString(),
  }, { eventType, subject: `payroll.${eventType}` });
}

/**
 * Get approximate queue message counts via Azure SB management API.
 * Returns null if not configured.
 */
async function getQueueStats() {
  const client = getSBClient();
  if (!client) return null;
  try {
    const { ServiceBusAdministrationClient } = require('@azure/service-bus');
    const adminClient = new ServiceBusAdministrationClient(process.env.AZURE_SB_CONNECTION_STRING);
    const hrQueue = await adminClient.getQueueRuntimeProperties(process.env.HR_QUEUE_NAME || 'hr-events');
    const payrollQueue = await adminClient.getQueueRuntimeProperties(process.env.PAYROLL_QUEUE_NAME || 'payroll-events');
    return {
      hrQueue: {
        name: hrQueue.name,
        activeMessageCount: hrQueue.activeMessageCount,
        deadLetterMessageCount: hrQueue.deadLetterMessageCount,
        scheduledMessageCount: hrQueue.scheduledMessageCount,
      },
      payrollQueue: {
        name: payrollQueue.name,
        activeMessageCount: payrollQueue.activeMessageCount,
        deadLetterMessageCount: payrollQueue.deadLetterMessageCount,
        scheduledMessageCount: payrollQueue.scheduledMessageCount,
      },
    };
  } catch (e) {
    console.warn('[servicebus] Could not get queue stats:', e.message);
    return null;
  }
}

module.exports = { publishHREvent, publishPayrollEvent, publishToQueue, getQueueStats };
