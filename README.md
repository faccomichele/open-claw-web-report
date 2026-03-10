# open-claw-web-report

A dynamic single-page web application that displays **Open Claw multi-agent activity flows**.  
Flow data is stored as JSON in Amazon S3 and served through an Amazon CloudFront distribution.  
All infrastructure is managed with Terraform.

---

## Architecture

```
Browser
  │
  └──► CloudFront (HTTPS, OAC)
           │
           └──► S3 Bucket
                  ├── index.html          ← web application
                  ├── css/style.css
                  ├── js/app.js
                  └── data/
                        └── flows.json    ← agent flow data (you upload this)
```

* **Amazon S3** – private bucket, no public access. CloudFront Origin Access Control (OAC) is the only entity that may read objects.
* **Amazon CloudFront** – HTTPS-only, redirects HTTP → HTTPS; dedicated cache behaviour for `/data/*` with a 30-second TTL so updated flow data is visible almost immediately.
* **Terraform** – manages S3 buckets, CloudFront distribution, OAC, bucket policies, and access-log configuration.

---

## Web Application

The web application (`web/`) is a dependency-free, vanilla HTML/CSS/JS single-page app.

### Features
- Fetches `data/flows.json` from the same CloudFront origin (relative URL `data/flows.json`)
- Auto-refreshes every **30 seconds**
- Manual **Refresh** button in the header
- Displays all flows in a sidebar, sorted newest-first
- Status badges: `completed`, `running`, `failed`
- Per-flow detail panel showing:
  - Flow overview (name, description, start/end time, duration)
  - Participating agents with colour-coded chips
  - Activity timeline (agent, action, input/output, duration, status)
  - Agent communication log (message from/to/content/timestamp)
- Responsive layout (collapses to single-column on small screens)

---

## JSON Data Schema

Upload a file named `flows.json` under the `data/` prefix in the S3 bucket:

```json
{
  "lastUpdated": "2026-03-09T13:00:00Z",
  "flows": [
    {
      "id":          "flow-001",
      "name":        "My Flow Name",
      "description": "What this flow does.",
      "startTime":   "2026-03-09T10:00:00Z",
      "endTime":     "2026-03-09T10:05:00Z",
      "status":      "completed",
      "agents": [
        { "id": "orchestrator", "name": "Orchestrator", "type": "orchestrator" },
        { "id": "worker-1",     "name": "Worker Agent", "type": "worker" }
      ],
      "activities": [
        {
          "id":        "act-001",
          "agentId":   "orchestrator",
          "action":    "Initialize Flow",
          "startTime": "2026-03-09T10:00:00Z",
          "endTime":   "2026-03-09T10:00:03Z",
          "status":    "completed",
          "input":     "User task description",
          "output":    "Flow started, delegating to Worker Agent."
        }
      ],
      "messages": [
        {
          "from":      "orchestrator",
          "to":        "worker-1",
          "content":   "Please handle this task.",
          "timestamp": "2026-03-09T10:00:03Z"
        }
      ]
    }
  ]
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `lastUpdated` | ISO-8601 string | ✓ | Shown in the page header |
| `flows[].id` | string | ✓ | Unique per flow |
| `flows[].status` | `"completed"` \| `"running"` \| `"failed"` | ✓ | Drives badge colour |
| `flows[].endTime` | ISO-8601 string \| `null` | | `null` for in-progress flows |
| `activities[].output` | string \| `null` | | `null` for in-progress activities |

See [`sample-data/flows.json`](sample-data/flows.json) for a complete example with four flows.

---

## Deployment

### Prerequisites
- [Terraform](https://www.terraform.io/) >= 1.6
- [AWS CLI](https://aws.amazon.com/cli/) with credentials configured
- An AWS account

### 1. Deploy infrastructure

```bash
cd terraform

terraform init
terraform plan -var="environment=prod"
terraform apply -var="environment=prod"
```

Outputs after `apply`:

| Output | Description |
|--------|-------------|
| `cloudfront_domain_name` | Public HTTPS URL of the web report |
| `cloudfront_distribution_id` | Used for cache invalidations |
| `website_bucket_name` | S3 bucket to upload content to |

### 2. Upload the web application

```bash
BUCKET=$(terraform -chdir=terraform output -raw website_bucket_name)

aws s3 sync web/ s3://$BUCKET/ \
  --delete \
  --cache-control "public, max-age=300"
```

### 3. Upload flow data

```bash
BUCKET=$(terraform -chdir=terraform output -raw website_bucket_name)

# Upload your own flows.json (or use the sample)
aws s3 cp sample-data/flows.json s3://$BUCKET/data/flows.json \
  --cache-control "public, max-age=30"
```

### 4. Invalidate CloudFront cache after updates

```bash
DIST_ID=$(terraform -chdir=terraform output -raw cloudfront_distribution_id)
aws cloudfront create-invalidation --distribution-id $DIST_ID --paths "/*"
```

### 5. Open the dashboard

```bash
terraform -chdir=terraform output cloudfront_domain_name
```

Navigate to the printed URL in your browser.

---

## Updating flow data

To refresh the data shown on the dashboard:

1. Update (or generate) your `flows.json` file.
2. Upload it to S3:
   ```bash
   aws s3 cp flows.json s3://$BUCKET/data/flows.json --cache-control "public, max-age=30"
   ```
3. The page auto-refreshes every 30 seconds, or users can click **Refresh**.  
   CloudFront caches `/data/*` for only 30 seconds, so the update is visible almost immediately.

---

## Configuration variables (`terraform/variables.tf`)

| Variable | Default | Description |
|----------|---------|-------------|
| `aws_region` | `us-east-1` | AWS region |
| `environment` | `prod` | Environment label |
| `project_name` | `open-claw-web-report` | Used in resource names |
| `cloudfront_price_class` | `PriceClass_100` | US + EU only (cheapest) |
| `cloudfront_default_ttl` | `300` | Default cache TTL (seconds) |
| `cloudfront_max_ttl` | `3600` | Maximum cache TTL (seconds) |
| `enable_s3_versioning` | `true` | Enable S3 versioning |

---

## License

See [LICENSE](LICENSE).
