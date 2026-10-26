# Local stack against real AWS

`make up-aws` runs the same local containers as `make up`, but with media in a real S3
bucket and mail through real SES instead of the Floci emulator. Use it to check the
bucket's CORS and KMS setup, SES deliverability, or a change to the storage or mail code
against the real services before deploying.

## What stays local and what does not

| Piece | `make up` | `make up-aws` |
| --- | --- | --- |
| Postgres, Redis, Mailpit | containers | containers |
| Stubs (Stripe, Razorpay, AI, EVS) | container | container (unless you point the variables at real services) |
| Media | Floci S3 | your S3 bucket (`STORAGE=s3`) |
| Mail | Floci SES, relayed to Mailpit | real SES (`MAIL_MODE=ses`): mail really goes out |
| AWS credentials | `test` / `test` | your AWS profile, mounted read-only into the API containers |

The overlay is [`deploy/compose/compose.aws.yaml`](../../deploy/compose/compose.aws.yaml).

## Prerequisites

- An S3 bucket and an SES identity, typically from an `aws-dev` deployment
  ([deploy-aws.md](deploy-aws.md)), or created by hand.
- The bucket's CORS rule must allow `http://localhost:3530` for browser uploads: add it in
  the aws-dev `terraform.tfvars` and apply:

  ```hcl
  media_cors_extra_origins = ["http://localhost:3530"]
  ```

- An AWS profile (`~/.aws`) that may `s3:GetObject`, `PutObject` and `DeleteObject` on the
  bucket, use its KMS key, and `ses:SendEmail` through the identity and configuration set.
- A verified sender address on that SES identity. In the SES sandbox, recipients must be
  verified too.

## Configure

```bash
cp deploy/compose/.env.aws.example deploy/compose/.env.aws
```

Fill it in from `terraform output` in `infra/terraform/envs/aws-dev`
([`.env.aws.example`](../../deploy/compose/.env.aws.example)):

| Key | Value |
| --- | --- |
| `AWS_REGION`, `S3_REGION`, `SES_REGION` | The region |
| `S3_BUCKET` | `terraform output media_bucket` |
| `SES_CONFIGURATION_SET` | `terraform output mail_configuration_set` |
| `MEDIA_ORIGINS` | `https://<bucket>.s3.<region>.amazonaws.com` (the CSP must allow presigned URLs) |
| `MAIL_FROM` | `Euron Open LMS <no-reply@<your verified domain>>` (required: SES refuses unverified senders) |
| `AWS_PROFILE` | Optional, defaults to `default` |

`.env.aws` holds no secrets: credentials come from the profile, and the local secrets stay
in `deploy/compose/.env` (`make env`). Values in `.env.aws` win over the compose defaults.
To check what a service will get:

```bash
docker compose --env-file deploy/compose/.env --env-file deploy/compose/.env.aws \
  -f deploy/compose/compose.yaml -f deploy/compose/compose.aws.yaml config api
```

## Start

```bash
make up-aws
make demo        # optional; the seed uploads covers and PDFs to the real bucket
```

The app is on http://localhost:3530 as usual. Uploads now PUT to the real bucket; mail goes
through SES and arrives in real inboxes (Mailpit stays empty).

## Notes

- `make down` stops both stacks and deletes the local volumes; it does not touch the bucket.
  Demo media written to a real bucket stays there until `maintenance.expire-uploads` or you
  remove it.
- The API still runs with `NODE_ENV=development`, so the production guard only warns.
- Payments, video and AI stay on the stubs unless you set the real `STRIPE_*`, `RAZORPAY_*`,
  `EVS_*` and `OPENAI_*` values in `deploy/compose/.env` ([payments.md](payments.md),
  [video-with-evs.md](video-with-evs.md)). Real gateways cannot deliver webhooks to
  `localhost`; use the Stripe CLI (`stripe listen --forward-to localhost:5026/api/webhooks/stripe`)
  or a tunnel, or rely on the return page and the reconcile job.
