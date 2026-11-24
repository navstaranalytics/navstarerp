# Navstar Analytics — M-Pesa Daraja setup

The school portal supports M-Pesa STK Push for Navstar subscription invoices and a separate, completely voluntary **Buy Navstar a soda** contribution. Soda contributions are not school fees, learner charges or subscription payments. Both remain pending until the Daraja callback is received and the checkout reference and amount match the pending payment.

## Configure Worker secrets

In Cloudflare Dashboard → Workers & Pages → navstarerp → Settings → Variables and Secrets, add:

| Name | Type | Value |
|---|---|---|
| MPESA_CONSUMER_KEY | Secret | Daraja app consumer key |
| MPESA_CONSUMER_SECRET | Secret | Daraja app consumer secret |
| MPESA_SHORTCODE | Variable/Secret | PayBill or Till shortcode |
| MPESA_PASSKEY | Secret | Daraja Lipa Na M-Pesa passkey |
| MPESA_CALLBACK_TOKEN | Secret | Generate a long random token (at least 32 random bytes) |
| MPESA_ENVIRONMENT | Variable | Defaults to `sandbox` if unset. Set to `sandbox` for testing; use `production` only after approval and successful sandbox verification. |
| MPESA_TRANSACTION_TYPE | Variable | `CustomerPayBillOnline` for PayBill; use the Daraja-supported Till type for a Buy Goods shortcode |

Never commit the consumer secret, passkey or callback token to GitHub or put them in browser code.

## Callback URL

Configure the callback URL used by the application as:

`https://YOUR-NAVSTAR-DOMAIN/api/payments/mpesa/callback?token=YOUR_MPESA_CALLBACK_TOKEN`

The application constructs this URL from the current Navstar origin and the Worker secret. Safaricom must be able to reach it over HTTPS.

## Test sequence

1. Apply all pending migrations to the D1 database. The voluntary soda contribution ledger is created by `migrations/0010_school_contributions.sql`; the deployment workflow applies pending migrations automatically.
2. Add your Daraja consumer key, consumer secret, shortcode and Lipa Na M-Pesa passkey as protected Cloudflare Worker secrets. Set `MPESA_ENVIRONMENT=sandbox` first and use Safaricom sandbox credentials and test MSISDNs. Switch to `production` only after the sandbox flow and callback are verified and Safaricom has approved production access.
3. For subscription testing, create a Navstar subscription invoice. For the voluntary soda test, sign in as a School Admin and open **Buy Navstar a soda**; choose KES 10–5,000 and enter a test phone number. The soda contribution is stored separately from all school fees and invoices.
4. Sign in to that school and open the Navstar subscription payment panel.
5. Submit a valid Safaricom number and complete the production STK prompt on a controlled low-value invoice.
6. Confirm that the payment remains pending until the callback arrives.
7. Confirm the invoice and subscription update only after a successful matching callback.
8. Accept live payments only after Safaricom has approved the production Daraja app and the production STK callback has been verified end-to-end.

## Important

- Soda contributions are optional appreciation payments and never appear as learner fee payments or subscription invoice settlements.
- A successful soda callback stores the M-Pesa receipt code, confirmed amount and transaction time in the school-scoped contribution ledger.
- Test with `MPESA_ENVIRONMENT=sandbox` before using production credentials or real money.
- A browser success message or an STK prompt is not proof of payment.
- Failed, cancelled, duplicate or amount-mismatched callbacks must not activate a subscription.
- The callback token is an additional endpoint guard. Keep it private and rotate it if exposed.
