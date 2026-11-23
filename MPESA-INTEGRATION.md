# Navstar Analytics — M-Pesa Daraja setup

The school portal supports M-Pesa STK Push for **Navstar subscription invoices**. A payment remains pending until the Daraja callback is received and its checkout reference and amount match the pending payment.

## Configure Worker secrets

In Cloudflare Dashboard → Workers & Pages → navstarerp → Settings → Variables and Secrets, add:

| Name | Type | Value |
|---|---|---|
| MPESA_CONSUMER_KEY | Secret | Daraja app consumer key |
| MPESA_CONSUMER_SECRET | Secret | Daraja app consumer secret |
| MPESA_SHORTCODE | Variable/Secret | PayBill or Till shortcode |
| MPESA_PASSKEY | Secret | Daraja Lipa Na M-Pesa passkey |
| MPESA_CALLBACK_TOKEN | Secret | Generate a long random token (at least 32 random bytes) |
| MPESA_ENV | Variable | `sandbox` for testing or `production` for live payments |
| MPESA_TRANSACTION_TYPE | Variable | `CustomerPayBillOnline` for PayBill; use the Daraja-supported Till type for a Buy Goods shortcode |

Never commit the consumer secret, passkey or callback token to GitHub or put them in browser code.

## Callback URL

Configure the callback URL used by the application as:

`https://YOUR-NAVSTAR-DOMAIN/api/payments/mpesa/callback?token=YOUR_MPESA_CALLBACK_TOKEN`

The application constructs this URL from the current Navstar origin and the Worker secret. Safaricom must be able to reach it over HTTPS.

## Test sequence

1. Apply `migrations/0005_samples_automation_payments.sql` to the production D1 database.
2. Add the Safaricom Daraja production consumer key, consumer secret, shortcode and Lipa Na M-Pesa passkey as protected Cloudflare Worker secrets. Set `MPESA_ENV=production`.
3. Create a Navstar subscription invoice for a test school.
4. Sign in to that school and open the Navstar subscription payment panel.
5. Submit a valid Safaricom number and complete the production STK prompt on a controlled low-value invoice.
6. Confirm that the payment remains pending until the callback arrives.
7. Confirm the invoice and subscription update only after a successful matching callback.
8. Accept live payments only after Safaricom has approved the production Daraja app and the production STK callback has been verified end-to-end.

## Important

- This integration does not collect learner fee payments; it is for Navstar subscription invoices.
- A browser success message or an STK prompt is not proof of payment.
- Failed, cancelled, duplicate or amount-mismatched callbacks must not activate a subscription.
- The callback token is an additional endpoint guard. Keep it private and rotate it if exposed.
