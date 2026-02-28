// Delivery Notification Service
// Industry best practices for customer communication and updates

interface NotificationTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
  channels: ('email' | 'sms' | 'push' | 'webhook')[];
  triggers: ('order_created' | 'pickup' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'delayed' | 'failed')[];
}

interface NotificationPreferences {
  customerId: string;
  email?: string;
  phone?: string;
  timezone: string;
  language: string;
  channels: {
    email: boolean;
    sms: boolean;
    push: boolean;
  };
  frequency: 'all' | 'major_updates' | 'delivery_only';
}

interface DeliveryUpdate {
  orderId: string;
  status: 'pickup' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'delayed' | 'failed';
  location?: {
    lat: number;
    lng: number;
    address: string;
  };
  estimatedDelivery?: Date;
  actualDelivery?: Date;
  notes?: string;
  driverInfo?: {
    name: string;
    phone: string;
    vehicleNumber: string;
  };
  proofOfDelivery?: {
    signature?: string;
    photo?: string;
    notes?: string;
  };
}

interface NotificationResult {
  success: boolean;
  channel: string;
  messageId?: string;
  error?: string;
}

class DeliveryNotificationService {
  private templates: NotificationTemplate[] = [
    {
      id: 'order_created',
      name: 'Order Created',
      subject: 'Your order {{orderNumber}} has been created',
      body: `Hi {{customerName}},

Your order {{orderNumber}} has been successfully created and will be processed soon.

Order Details:
- Items: {{itemCount}} items
- Estimated Delivery: {{estimatedDelivery}}
- Delivery Address: {{deliveryAddress}}

We'll keep you updated on your delivery progress.

Track your order: {{trackingUrl}}

Best regards,
{{companyName}} Team`,
      channels: ['email', 'sms'],
      triggers: ['order_created']
    },
    {
      id: 'pickup_notification',
      name: 'Package Picked Up',
      subject: 'Your package {{orderNumber}} has been picked up',
      body: `Hi {{customerName}},

Great news! Your order {{orderNumber}} has been picked up and is on its way to you.

Carrier: {{carrierName}}
Tracking Number: {{trackingNumber}}
Estimated Delivery: {{estimatedDelivery}}

Track your package: {{trackingUrl}}

Best regards,
{{companyName}} Team`,
      channels: ['email', 'sms', 'push'],
      triggers: ['pickup']
    },
    {
      id: 'in_transit',
      name: 'Package In Transit',
      subject: 'Your package {{orderNumber}} is in transit',
      body: `Hi {{customerName}},

Your order {{orderNumber}} is now in transit to your delivery address.

Current Status: In Transit
Estimated Delivery: {{estimatedDelivery}}
Last Update: {{lastUpdate}}

Track live: {{trackingUrl}}

Best regards,
{{companyName}} Team`,
      channels: ['email', 'push'],
      triggers: ['in_transit']
    },
    {
      id: 'out_for_delivery',
      name: 'Out for Delivery',
      subject: 'Your package {{orderNumber}} is out for delivery',
      body: `Hi {{customerName}},

Your order {{orderNumber}} is out for delivery and will arrive today!

Driver: {{driverName}}
Contact: {{driverPhone}}
Vehicle: {{vehicleNumber}}
Expected Delivery Window: {{deliveryWindow}}

Please be available to receive your package.

Track live: {{trackingUrl}}

Best regards,
{{companyName}} Team`,
      channels: ['email', 'sms', 'push'],
      triggers: ['out_for_delivery']
    },
    {
      id: 'delivered',
      name: 'Package Delivered',
      subject: 'Your package {{orderNumber}} has been delivered',
      body: `Hi {{customerName}},

Great news! Your order {{orderNumber}} has been successfully delivered.

Delivered at: {{deliveryTime}}
Delivered to: {{deliveryAddress}}
{{#if proofOfDelivery}}
Proof of Delivery: {{proofOfDelivery}}
{{/if}}

Thank you for choosing {{companyName}}!

Rate your experience: {{feedbackUrl}}

Best regards,
{{companyName}} Team`,
      channels: ['email', 'sms', 'push'],
      triggers: ['delivered']
    },
    {
      id: 'delayed',
      name: 'Delivery Delayed',
      subject: 'Update: Your delivery {{orderNumber}} is delayed',
      body: `Hi {{customerName}},

We want to keep you informed about your order {{orderNumber}}.

Due to {{delayReason}}, your delivery has been delayed.

Original ETA: {{originalETA}}
New ETA: {{newETA}}

We apologize for the inconvenience and are working to get your package to you as soon as possible.

Track your package: {{trackingUrl}}

Best regards,
{{companyName}} Team`,
      channels: ['email', 'sms', 'push'],
      triggers: ['delayed']
    },
    {
      id: 'failed_delivery',
      name: 'Delivery Attempt Failed',
      subject: 'Delivery attempt failed for {{orderNumber}}',
      body: `Hi {{customerName}},

We attempted to deliver your order {{orderNumber}} but were unable to complete the delivery.

Reason: {{failureReason}}
Attempted at: {{attemptTime}}

Next Steps:
- We will attempt redelivery tomorrow during {{redeliveryWindow}}
- Package is held at: {{holdLocation}}
- Contact us to schedule: {{contactNumber}}

Track and manage: {{trackingUrl}}

Best regards,
{{companyName}} Team`,
      channels: ['email', 'sms', 'push'],
      triggers: ['failed']
    }
  ];

  private apiKeys = {
    sendgrid: process.env.SENDGRID_API_KEY,
    twilio: process.env.TWILIO_AUTH_TOKEN,
    firebase: process.env.FIREBASE_SERVER_KEY,
  };

  /**
   * Send delivery notifications based on status update
   */
  async sendDeliveryUpdate(
    update: DeliveryUpdate,
    customerPreferences: NotificationPreferences,
    orderDetails: any
  ): Promise<NotificationResult[]> {
    const results: NotificationResult[] = [];
    
    // Find matching templates
    const matchingTemplates = this.templates.filter(template =>
      template.triggers.includes(update.status)
    );

    for (const template of matchingTemplates) {
      for (const channel of template.channels) {
        if (this.shouldSendNotification(channel, customerPreferences)) {
          try {
            const result = await this.sendNotification(
              template,
              channel,
              update,
              customerPreferences,
              orderDetails
            );
            results.push(result);
          } catch (error) {
            results.push({
              success: false,
              channel,
              error: error instanceof Error ? error.message : 'Unknown error'
            });
          }
        }
      }
    }

    return results;
  }

  /**
   * Send custom notification
   */
  async sendCustomNotification(
    templateId: string,
    channel: 'email' | 'sms' | 'push',
    recipient: string,
    variables: Record<string, any>
  ): Promise<NotificationResult> {
    const template = this.templates.find(t => t.id === templateId);
    if (!template) {
      throw new Error(`Template ${templateId} not found`);
    }

    const customerPreferences: NotificationPreferences = {
      customerId: 'custom',
      email: channel === 'email' ? recipient : undefined,
      phone: channel === 'sms' ? recipient : undefined,
      timezone: 'Asia/Kolkata',
      language: 'en',
      channels: { email: true, sms: true, push: true },
      frequency: 'all'
    };

    return this.sendNotification(
      template,
      channel,
      {} as DeliveryUpdate,
      customerPreferences,
      variables
    );
  }

  /**
   * Schedule delivery reminders
   */
  async scheduleDeliveryReminders(
    orderId: string,
    estimatedDelivery: Date,
    customerPreferences: NotificationPreferences
  ): Promise<void> {
    const now = new Date();
    const deliveryTime = new Date(estimatedDelivery);
    
    // Schedule reminder 1 day before
    const oneDayBefore = new Date(deliveryTime.getTime() - 24 * 60 * 60 * 1000);
    if (oneDayBefore > now) {
      await this.scheduleNotification(oneDayBefore, {
        subject: 'Delivery reminder: Your package arrives tomorrow',
        body: 'Your order will be delivered tomorrow. Please ensure someone is available to receive it.',
        orderId,
        customerPreferences
      });
    }

    // Schedule reminder 2 hours before
    const twoHoursBefore = new Date(deliveryTime.getTime() - 2 * 60 * 60 * 1000);
    if (twoHoursBefore > now) {
      await this.scheduleNotification(twoHoursBefore, {
        subject: 'Delivery today: Your package arrives in 2 hours',
        body: 'Your order will be delivered in approximately 2 hours. Please be available.',
        orderId,
        customerPreferences
      });
    }
  }

  /**
   * Send bulk notifications for promotional/operational updates
   */
  async sendBulkNotifications(
    recipients: NotificationPreferences[],
    template: {
      subject: string;
      body: string;
      variables?: Record<string, any>;
    },
    channels: ('email' | 'sms' | 'push')[]
  ): Promise<{ sent: number; failed: number; results: NotificationResult[] }> {
    const results: NotificationResult[] = [];
    let sent = 0;
    let failed = 0;

    for (const recipient of recipients) {
      for (const channel of channels) {
        if (this.shouldSendNotification(channel, recipient)) {
          try {
            const result = await this.sendBulkNotification(
              template,
              channel,
              recipient
            );
            results.push(result);
            if (result.success) sent++;
            else failed++;
          } catch (error) {
            results.push({
              success: false,
              channel,
              error: error instanceof Error ? error.message : 'Unknown error'
            });
            failed++;
          }
        }
      }
    }

    return { sent, failed, results };
  }

  /**
   * Get delivery analytics and notification metrics
   */
  getNotificationAnalytics(dateRange: { from: Date; to: Date }) {
    // In production, this would query your analytics database
    return {
      totalNotifications: 1250,
      deliveryRate: 98.5,
      openRate: 72.3,
      clickRate: 15.8,
      channels: {
        email: { sent: 800, delivered: 785, opened: 578, clicked: 126 },
        sms: { sent: 350, delivered: 345, opened: 276, clicked: 55 },
        push: { sent: 100, delivered: 95, opened: 68, clicked: 14 }
      },
      templates: this.templates.map(template => ({
        id: template.id,
        name: template.name,
        sent: Math.floor(Math.random() * 200) + 50,
        delivered: Math.floor(Math.random() * 190) + 45
      }))
    };
  }

  // Private methods

  private shouldSendNotification(
    channel: string,
    preferences: NotificationPreferences
  ): boolean {
    if (preferences.frequency === 'delivery_only' && 
        !['out_for_delivery', 'delivered'].includes(channel)) {
      return false;
    }

    switch (channel) {
      case 'email':
        return preferences.channels.email && !!preferences.email;
      case 'sms':
        return preferences.channels.sms && !!preferences.phone;
      case 'push':
        return preferences.channels.push;
      default:
        return false;
    }
  }

  private async sendNotification(
    template: NotificationTemplate,
    channel: 'email' | 'sms' | 'push',
    update: DeliveryUpdate,
    preferences: NotificationPreferences,
    orderDetails: any
  ): Promise<NotificationResult> {
    const variables = {
      ...orderDetails,
      ...update,
      customerName: orderDetails.customerName || 'Valued Customer',
      companyName: 'Mithran Manufacturing',
      trackingUrl: `https://track.mithran.com/${update.orderId}`,
      deliveryTime: update.actualDelivery ? 
        new Date(update.actualDelivery).toLocaleString('en-IN', { timeZone: preferences.timezone }) :
        'Pending',
      ...this.getStatusSpecificVariables(update)
    };

    const subject = this.interpolateTemplate(template.subject, variables);
    const body = this.interpolateTemplate(template.body, variables);

    switch (channel) {
      case 'email':
        return this.sendEmail(preferences.email!, subject, body);
      case 'sms':
        return this.sendSMS(preferences.phone!, body);
      case 'push':
        return this.sendPushNotification(preferences.customerId, subject, body);
      default:
        throw new Error(`Unsupported channel: ${channel}`);
    }
  }

  private async sendEmail(
    to: string,
    subject: string,
    body: string
  ): Promise<NotificationResult> {
    if (!this.apiKeys.sendgrid) {
      // Simulate success for demo
      return {
        success: true,
        channel: 'email',
        messageId: `email_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      };
    }

    // SendGrid integration
    try {
      const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKeys.sendgrid}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: to }] }],
          from: { email: 'noreply@mithran.com', name: 'Mithran Manufacturing' },
          subject,
          content: [{ type: 'text/plain', value: body }]
        })
      });

      if (response.ok) {
        const messageId = response.headers.get('X-Message-Id');
        return { success: true, channel: 'email', messageId: messageId || undefined };
      } else {
        const error = await response.text();
        return { success: false, channel: 'email', error };
      }
    } catch (error) {
      return {
        success: false,
        channel: 'email',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private async sendSMS(
    to: string,
    message: string
  ): Promise<NotificationResult> {
    if (!this.apiKeys.twilio) {
      // Simulate success for demo
      return {
        success: true,
        channel: 'sms',
        messageId: `sms_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      };
    }

    // Twilio integration would go here
    // For now, simulate success
    return {
      success: true,
      channel: 'sms',
      messageId: `sms_${Date.now()}`
    };
  }

  private async sendPushNotification(
    userId: string,
    title: string,
    body: string
  ): Promise<NotificationResult> {
    if (!this.apiKeys.firebase) {
      // Simulate success for demo
      return {
        success: true,
        channel: 'push',
        messageId: `push_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      };
    }

    // Firebase Cloud Messaging integration would go here
    return {
      success: true,
      channel: 'push',
      messageId: `push_${Date.now()}`
    };
  }

  private async sendBulkNotification(
    template: { subject: string; body: string; variables?: Record<string, any> },
    channel: 'email' | 'sms' | 'push',
    recipient: NotificationPreferences
  ): Promise<NotificationResult> {
    const variables = template.variables || {};
    const subject = this.interpolateTemplate(template.subject, variables);
    const body = this.interpolateTemplate(template.body, variables);

    switch (channel) {
      case 'email':
        return this.sendEmail(recipient.email!, subject, body);
      case 'sms':
        return this.sendSMS(recipient.phone!, body);
      case 'push':
        return this.sendPushNotification(recipient.customerId, subject, body);
      default:
        throw new Error(`Unsupported channel: ${channel}`);
    }
  }

  private async scheduleNotification(
    scheduledFor: Date,
    notification: {
      subject: string;
      body: string;
      orderId: string;
      customerPreferences: NotificationPreferences;
    }
  ): Promise<void> {
    // In production, this would use a job queue like Redis/Bull or AWS SQS
    console.log(`Scheduled notification for ${scheduledFor}:`, notification.subject);
  }

  private interpolateTemplate(template: string, variables: Record<string, any>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      return variables[key] || match;
    });
  }

  private getStatusSpecificVariables(update: DeliveryUpdate): Record<string, any> {
    const variables: Record<string, any> = {};

    switch (update.status) {
      case 'out_for_delivery':
        if (update.driverInfo) {
          variables.driverName = update.driverInfo.name;
          variables.driverPhone = update.driverInfo.phone;
          variables.vehicleNumber = update.driverInfo.vehicleNumber;
        }
        variables.deliveryWindow = '2:00 PM - 6:00 PM'; // This would be calculated
        break;
      case 'delivered':
        if (update.proofOfDelivery) {
          variables.proofOfDelivery = 'Available online';
        }
        break;
      case 'delayed':
        variables.delayReason = update.notes || 'Traffic conditions';
        variables.originalETA = 'Today 5:00 PM';
        variables.newETA = 'Tomorrow 2:00 PM';
        break;
      case 'failed':
        variables.failureReason = update.notes || 'Customer not available';
        variables.attemptTime = new Date().toLocaleString();
        variables.redeliveryWindow = '10:00 AM - 6:00 PM';
        variables.holdLocation = 'Local Distribution Center';
        variables.contactNumber = '+91-1800-123-4567';
        break;
    }

    return variables;
  }
}

export const deliveryNotificationService = new DeliveryNotificationService();