export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
}

export interface EmailProvider {
  send(params: SendEmailParams): Promise<void>;
}

export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');