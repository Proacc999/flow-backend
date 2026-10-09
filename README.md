# WhatsApp Flows API — Phase 2

This Express service creates draft Flows in Meta and stores their local records
in MongoDB. It keeps the React application's current `mobileNo` selection and
maps that number to the WABA ID required by Meta.

## Run MongoDB with Docker

```bash
docker run -d --name whatsapp-flows-mongodb --restart unless-stopped -p 127.0.0.1:27017:27017 --mount "type=bind,source=C:\Users\HP\Desktop\wa flows\server\mongodb-data,target=/data/db" mongo:8.0
```

The project folder `server/mongodb-data` preserves the database when the
container is stopped or recreated. MongoDB storage files are binary; inspect
documents with `mongosh` or MongoDB Compass. Start an existing stopped
container with:

```bash
docker start whatsapp-flows-mongodb
```

## Configure

Copy `.env.example` to `.env`, then set `META_ACCESS_TOKEN` to a valid Meta
temporary token or System User token. Keep `.env` private; it is ignored by
Git.

The existing React WABA numbers are mapped in `META_WABA_ACCOUNTS_JSON`. Update
the mapping if the accounts in the UI change.

The default local database connection is:

```env
MONGODB_URI=mongodb://127.0.0.1:27017/whatsapp_flows
```

## Run

```bash
npm install
npm run dev
```

The API runs at `http://localhost:4000`. Check it with:

```text
GET http://localhost:4000/api/health
```

The React client defaults to this address. To use another address, copy the
client `.env.example` to `.env` and change `VITE_API_BASE_URL`.

## Create a draft Flow

```text
POST /api/whatsapp/createflows
Content-Type: application/json
```

```json
{
  "name": "My first flow",
  "categories": ["OTHER"],
  "wabaNumber": "919251006460",
  "flowJson": {
    "version": "7.1",
    "screens": [
      {
        "id": "WELCOME",
        "title": "Welcome",
        "terminal": true,
        "layout": {
          "type": "SingleColumnLayout",
          "children": [
            { "type": "TextHeading", "text": "Hello World" },
            {
              "type": "Footer",
              "label": "Complete",
              "on-click-action": { "name": "complete", "payload": {} }
            }
          ]
        }
      }
    ]
  }
}
```

The service sends one request to Meta containing `name`, `categories`, the
stringified `flow_json`, and `publish: false`. It never publishes the Flow.
Meta validation errors are returned with the created Flow ID so the draft is
not mistaken for a completely failed request. After Meta succeeds, the Flow ID,
generated Flow JSON, WABA details, status, and validation result are saved in
MongoDB.

## List saved Flows

```text
GET /api/whatsapp/getAllFlows
```

The endpoint calls Meta's `GET /{WABA-ID}/flows` API for every configured WABA,
upserts the returned metadata into MongoDB, and returns the synchronized records
newest first in the shape expected by the `WhatsappFlows` React table. Limit
the request to one configured account with:

```text
GET /api/whatsapp/getAllFlows?wabaNumber=919251006460
```

The current configuration contains one WABA, so a Meta retrieval error fails
the request directly instead of returning a partial-result warning.

## Export Flow JSON

Download the Flow JSON using the Flow name as the filename:

```text
GET /api/whatsapp/flows/:flowId/export
```

## Publish and delete Flows

Publish a draft Flow on Meta and update its MongoDB status:

```text
POST /api/whatsapp/flows/:flowId/publish
```

Delete a draft Flow from Meta and MongoDB:

```text
DELETE /api/whatsapp/flows/:flowId
```

Meta does not allow a published Flow to be edited or deleted.

## Test

```bash
npm test
```

Tests mock Meta and MongoDB; they do not use a real token, create Meta Flows, or
write database records.
