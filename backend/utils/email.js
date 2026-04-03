const nodemailer = require('nodemailer');
const logger = require('./logger');

const createTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_PORT === '465', // true for 465, false for other ports
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
};

const sendEmail = async ({ to, subject, html, text }) => {
  try {
    const transporter = createTransporter();
    const info = await transporter.sendMail({
      from: `"${process.env.FROM_NAME || 'CartLy'}" <${process.env.FROM_EMAIL}>`,
      to,
      subject,
      html,
      text: text || html.replace(/<[^>]*>/g, ''),
    });
    logger.info(`Email sent to ${to}: ${info.messageId}`);
    return info;
  } catch (error) {
    logger.error(`Email send failed to ${to}: ${error.message}`);
    throw error;
  }
};

const emailTemplates = {
  verification: (name, token, frontendUrl) => ({
    subject: 'Verify Your Email — CartLy',
    html: `
      <div style="font-family: 'Manrope', sans-serif; max-width: 600px; margin: 0 auto; background: #f9f9fb; padding: 40px;">
        <div style="background: linear-gradient(135deg, #1A237E, #283593); padding: 40px; border-radius: 4px; margin-bottom: 24px; text-align: center;">
          <h1 style="color: white; font-size: 32px; margin: 0; letter-spacing: -1px;">CartLy</h1>
        </div>
        <div style="background: white; padding: 40px; border-radius: 4px;">
          <h2 style="color: #1a1c1d; font-size: 24px; margin-bottom: 16px;">Welcome, ${name}!</h2>
          <p style="color: #454652; line-height: 1.6;">Please verify your email address to complete your registration.</p>
          <a href="${frontendUrl}/verify-email/${token}" 
             style="display: inline-block; background: #1A237E; color: white; padding: 16px 32px; 
                    border-radius: 4px; text-decoration: none; font-weight: bold; margin: 24px 0; 
                    font-size: 12px; letter-spacing: 2px; text-transform: uppercase;">
            VERIFY EMAIL
          </a>
          <p style="color: #767683; font-size: 12px;">This link expires in 24 hours. If you didn't register, ignore this email.</p>
        </div>
      </div>
    `,
  }),

  passwordReset: (name, token, frontendUrl) => ({
    subject: 'Password Reset Request — CartLy',
    html: `
      <div style="font-family: 'Manrope', sans-serif; max-width: 600px; margin: 0 auto; background: #f9f9fb; padding: 40px;">
        <div style="background: linear-gradient(135deg, #1A237E, #283593); padding: 40px; border-radius: 4px; margin-bottom: 24px; text-align: center;">
          <h1 style="color: white; font-size: 32px; margin: 0; letter-spacing: -1px;">CartLy</h1>
        </div>
        <div style="background: white; padding: 40px; border-radius: 4px;">
          <h2 style="color: #1a1c1d; font-size: 24px;">Reset Your Password</h2>
          <p style="color: #454652; line-height: 1.6;">Hi ${name}, we received a request to reset your password.</p>
          <a href="${frontendUrl}/reset-password/${token}" 
             style="display: inline-block; background: #1A237E; color: white; padding: 16px 32px; 
                    border-radius: 4px; text-decoration: none; font-weight: bold; margin: 24px 0;
                    font-size: 12px; letter-spacing: 2px; text-transform: uppercase;">
            RESET PASSWORD
          </a>
          <p style="color: #767683; font-size: 12px;">This link expires in 10 minutes. If you didn't request this, please secure your account.</p>
        </div>
      </div>
    `,
  }),

  orderConfirmation: (order, user) => ({
    subject: `Order Confirmed #${order._id} — CartLy`,
    html: `
      <div style="font-family: 'Manrope', sans-serif; max-width: 600px; margin: 0 auto; background: #f9f9fb; padding: 40px;">
        <div style="background: linear-gradient(135deg, #1A237E, #283593); padding: 40px; border-radius: 4px; margin-bottom: 24px; text-align: center;">
          <h1 style="color: white; font-size: 32px; margin: 0; letter-spacing: -1px;">CartLy</h1>
        </div>
        <div style="background: white; padding: 40px; border-radius: 4px;">
          <h2 style="color: #1a1c1d;">Order Confirmed!</h2>
          <p style="color: #454652;">Hi ${user.name}, your order has been confirmed.</p>
          <p style="color: #1A237E; font-weight: bold; font-size: 18px;">Order #${order._id}</p>
          <p style="color: #454652;">Total: <strong>$${order.totalPrice.toFixed(2)}</strong></p>
          <p style="color: #767683; font-size: 12px;">You'll receive a shipping notification soon.</p>
        </div>
      </div>
    `,
  }),

  sellerApproval: (name) => ({
    subject: 'Seller Account Approved — CartLy',
    html: `
      <div style="font-family: 'Manrope', sans-serif; max-width: 600px; margin: 0 auto; background: #f9f9fb; padding: 40px;">
        <div style="background: linear-gradient(135deg, #1A237E, #283593); padding: 40px; border-radius: 4px; margin-bottom: 24px; text-align: center;">
          <h1 style="color: white; font-size: 32px; margin: 0; letter-spacing: -1px;">CartLy</h1>
        </div>
        <div style="background: white; padding: 40px; border-radius: 4px;">
          <h2 style="color: #1a1c1d;">Congratulations, ${name}!</h2>
          <p style="color: #454652; line-height: 1.6;">Your seller account has been approved. You can now list products on CartLy marketplace.</p>
          <p style="color: #767683; font-size: 12px;">Start your journey by logging in and navigating to your Seller Dashboard.</p>
        </div>
      </div>
    `,
  }),
};

module.exports = { sendEmail, emailTemplates };
