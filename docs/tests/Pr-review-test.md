The Azure webhook handler path:
  POST /api/webhooks/azure/:orgSlug                           
    → verifies x-webhook-secret header
    → resolves repoId from                                    
  payload.resource.repository.remoteUrl                     
    → processAzurePR() → runReview() with incrementalDiff=true
   on updates                                                 

  Setup in Azure DevOps (Project Settings → Service Hooks →
  Web Hooks):

  ┌─────────┬─────────────────────────────────────────────┐
  │  Field  │                    Value                    │
  ├─────────┼─────────────────────────────────────────────┤
  │ URL     │ https://ashishs-macbook-air-1.tail4cb76f.ts.net/api/webhooks/azure/default │
  ├─────────┼─────────────────────────────────────────────┤
  │ HTTP    │ x-webhook-secret: <your secret from         │
  │ Headers │ org_webhook_secrets or WEBHOOK_SECRET>      │
  ├─────────┼─────────────────────────────────────────────┤
  │ Trigger │ Pull request created                        │
  └─────────┴─────────────────────────────────────────────┘

  Add a second service hook for:

  ┌──────────┬─────────────────────────────────────────────┐
  │  Field   │                    Value                    │
  ├──────────┼─────────────────────────────────────────────┤
  │ URL      │ https://<tunnel>/api/webhooks/azure/default │
  ├──────────┼─────────────────────────────────────────────┤
  │ HTTP     │ x-webhook-secret: <same secret>             │
  │ Headers  │                                             │
  ├──────────┼─────────────────────────────────────────────┤
  │ Trigger  │ Pull request updated                        │
  └──────────┴─────────────────────────────────────────────┘

  One thing to watch: Azure DevOps sends the test payload
  immediately when you save the service hook. The test payload
   has eventType: "git.pullrequest.created" but with a dummy
  PR. Your server will return 200 (the repoId lookup will just
   fail silently and short-circuit). That's expected.

  Quick check that the secret is wired correctly before
  opening a PR:

  # Get the secret you configured
  docker compose exec db psql -U postgres -d agnusai \
    -c "SELECT secret FROM org_webhook_secrets WHERE platform
  = 'azure';"

  # Manually fire the test payload Azure sends
  curl -X POST https://<tunnel>/api/webhooks/azure/default \
    -H "Content-Type: application/json" \
    -H "x-webhook-secret: <secret>" \
    -d '{"eventType":"git.pullrequest.created","resource":{"pu
  llRequestId":1,"targetRefName":"refs/heads/main","repository
  ":{"remoteUrl":"https://dev.azure.com/yourorg/yourproject/_g
  it/yourrepo"}}}'
  # Should return {"ok":true} — not 401

  If that returns {"ok":true} the auth is wired up. Then
  opening or pushing to a PR will fire the real webhook with a
   full payload and trigger the review.
