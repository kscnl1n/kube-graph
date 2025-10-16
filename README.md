# Kubernetes YAML Dependency Graph (Web Tool)

This is a small web app that reads Kubernetes YAML files and draws a dependency graph between resources.

It tries to detect references like:

- Deployment -> ConfigMap/Secret/PVC (volumes + env refs)
- Ingress -> Service
- Service -> Workloads (basic selector match)

> Note: This is a practical student-style tool, so it focuses on common manifest patterns and not every advanced Kubernetes edge case.

## Features

- Upload one or many `.yaml`/`.yml` files
- Or paste YAML directly in a text area
- Visual graph rendered in-browser
- List of detected dependency edges
- Simple local server so users can run it after download

## Run Locally

1. Install Node.js (v18+ suggested).
2. In this project folder, run:

```bash
npm install
npm run start
```

3. Open [http://localhost:4173](http://localhost:4173)

## Download + Use

Users can download this folder (zip or clone), then run `npm install` and `npm run start`.

## Project Structure

- `server.js` - tiny static file server
- `public/index.html` - app UI
- `public/styles.css` - styles
- `public/app.js` - YAML parsing + dependency detection + graph drawing

## Known Limitations

- Dependency detection is heuristic and only supports common resource references.
- Graph readability may vary with very large manifests.
- Namespace matching is basic (mostly same-namespace lookup).
