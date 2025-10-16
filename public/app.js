const fileInput = document.getElementById("yamlFiles");
const yamlText = document.getElementById("yamlText");
const buildGraphBtn = document.getElementById("buildGraphBtn");
const sampleBtn = document.getElementById("sampleBtn");
const clearBtn = document.getElementById("clearBtn");
const exportPngBtn = document.getElementById("exportPngBtn");
const exportSvgBtn = document.getElementById("exportSvgBtn");


// ELEMENT FOR NODE COUNT HERE
const nodeCountEl = document.getElementById("nodeCount");



const edgeCountEl = document.getElementById("edgeCount");
const docCountEl = document.getElementById("docCount");
const dependencyList = document.getElementById("dependencyList");

let cy = null;

function resourceId(doc) {
  const kind = doc?.kind || "UnknownKind";
  const ns = doc?.metadata?.namespace || "default";
  const name = doc?.metadata?.name || "unnamed";
  return `${kind}/${ns}/${name}`;
}

function safeGet(obj, path, fallback = undefined) {
  try {
    return path.split(".").reduce((acc, key) => (acc ? acc[key] : undefined), obj) ?? fallback;
  } catch (e) {
    return fallback;
  }
}

// random helper i made and never ended up using lol
function deepCloneForNoReason(input) {
  if (input === null || input === undefined) return input;
  try {
    return JSON.parse(JSON.stringify(input));
  } catch (err) {
    return input;
  }
}

function isK8sObject(doc) {
  return !!(doc && typeof doc === "object" && doc.kind && doc.metadata && doc.metadata.name);
}

function parseYamlDocuments(text) {
  const out = [];

  try {
    window.jsyaml.loadAll(text, (doc) => {
      if (doc) out.push(doc);
    });
  } catch (err) {
    throw new Error(`YAML parse error: ${err.message}`);
  }
  return out;
}

// super hand-made detector for common references - doesn't handle all cases so be wary here
// PATCH WITH NEXT UPDATE - 03/29/2026
function detectDependencies(resources) {
  const deps = [];
  const idByKindName = new Map();

  for (const res of resources) {
    const kind = res.kind;
    const ns = safeGet(res, "metadata.namespace", "default");
    const name = safeGet(res, "metadata.name", "unnamed");
    idByKindName.set(`${kind}:${ns}:${name}`, resourceId(res));
  }

  function maybeConnect(sourceRes, targetKind, targetName, reason) {
    const sourceNs = safeGet(sourceRes, "metadata.namespace", "default");
    const lookupKey = `${targetKind}:${sourceNs}:${targetName}`;
    const sourceId = resourceId(sourceRes);
    const targetId = idByKindName.get(lookupKey);
    if (targetId) {
      deps.push({
        source: sourceId,
        target: targetId,
        reason
      });
    }
  }

  for (const res of resources) {
    const kind = res.kind;
    if (kind === "Deployment" || kind === "StatefulSet" || kind === "DaemonSet") {
      const volumes = safeGet(res, "spec.template.spec.volumes", []);
      for (const v of volumes) {
        if (v.configMap && v.configMap.name) {
          maybeConnect(res, "ConfigMap", v.configMap.name, "volume uses configmap");
        }
        if (v.secret && v.secret.secretName) {
          maybeConnect(res, "Secret", v.secret.secretName, "volume uses secret");
        }
        if (v.persistentVolumeClaim && v.persistentVolumeClaim.claimName) {
          maybeConnect(res, "PersistentVolumeClaim", v.persistentVolumeClaim.claimName, "volume uses pvc");
        }
      }




      // gets the envFrom and the env from the contrainer and connects the configmap

      const envFromContainers = safeGet(res, "spec.template.spec.containers", []);
      for (const c of envFromContainers) {
        const envFrom = c.envFrom || [];
        for (const ef of envFrom) {
          if (ef.configMapRef && ef.configMapRef.name) {
            maybeConnect(res, "ConfigMap", ef.configMapRef.name, "envFrom configmap");
          }
          if (ef.secretRef && ef.secretRef.name) {
            maybeConnect(res, "Secret", ef.secretRef.name, "envFrom secret");
          }
        }

        const env = c.env || [];
        for (const e of env) {
          const ref = e.valueFrom || {};
          if (ref.configMapKeyRef && ref.configMapKeyRef.name) {
            maybeConnect(res, "ConfigMap", ref.configMapKeyRef.name, "env configmapKeyRef");
          }
          if (ref.secretKeyRef && ref.secretKeyRef.name) {
            maybeConnect(res, "Secret", ref.secretKeyRef.name, "env secretKeyRef");
          }
        }
      }
    }

    if (kind === "Ingress") {
      const rules = safeGet(res, "spec.rules", []);
      for (const rule of rules) {
        const paths = safeGet(rule, "http.paths", []);
        for (const p of paths) {
          const serviceName = safeGet(p, "backend.service.name");
          if (serviceName) maybeConnect(res, "Service", serviceName, "ingress routes to service");
        }
      }
    }

    // ARRRRRRGHHHH
    if (kind === "Service") {
      // maybe loose relationship with deployment based on selector labels
      const selector = safeGet(res, "spec.selector", {});
      const selectorKeys = Object.keys(selector || {});
      if (selectorKeys.length > 0) {
        for (const other of resources) {
          if (!["Deployment", "StatefulSet", "DaemonSet", "Pod"].includes(other.kind)) continue;
          const labels = safeGet(other, "spec.template.metadata.labels", safeGet(other, "metadata.labels", {}));
          const matched = selectorKeys.every((k) => labels && labels[k] === selector[k]);
          if (matched) {
            deps.push({
              source: resourceId(res),
              target: resourceId(other),
              reason: "service selector matches workload labels"
            });
          }
        }
      }
    }
  }

  return deps;
}

function buildElements(resources, deps) {
  const nodes = resources.map((res) => {
    const id = resourceId(res);
    return {
      data: {
        id,
        label: `${res.kind}\n${safeGet(res, "metadata.name", "unnamed")}`
      },
      classes: `kind-${(res.kind || "unknown").toLowerCase()}`
    };
  });

  const edges = deps.map((d, i) => ({
    data: {
      id: `edge-${i}-${d.source}-${d.target}`,
      source: d.source,
      target: d.target,
      label: d.reason
    }
  }));

  return [...nodes, ...edges];
}

function drawGraph(resources, deps) {
  const elements = buildElements(resources, deps);
  const container = document.getElementById("graph");

  if (cy) cy.destroy();

  cy = cytoscape({
    container,
    elements,
    style: [
      {
        selector: "node",
        style: {
          "background-color": "#38bdf8",
          label: "data(label)",
          color: "#e2e8f0",
          "font-size": 10,
          "text-valign": "center",
          "text-wrap": "wrap",
          "text-max-width": 90
        }
      },
      {
        selector: "edge",
        style: {
          width: 2,
          "line-color": "#94a3b8",
          "target-arrow-color": "#94a3b8",
          "target-arrow-shape": "triangle",
          "curve-style": "bezier",
          label: "data(label)",
          "font-size": 8,
          color: "#cbd5e1"
        }
      },
      {
        selector: ".kind-secret",
        style: { "background-color": "#f472b6" }
      },
      {
        selector: ".kind-configmap",
        style: { "background-color": "#22d3ee" }
      },
      {
        selector: ".kind-service",
        style: { "background-color": "#34d399" }
      },
      {
        selector: ".kind-ingress",
        style: { "background-color": "#f59e0b" }
      }
    ],
    layout: {
      name: "cose",
      animate: false
    }
  });
}

function updateStats(resources, deps) {
  nodeCountEl.textContent = `Nodes: ${resources.length}`;
  edgeCountEl.textContent = `Edges: ${deps.length}`;
  docCountEl.textContent = `Resources: ${resources.length}`;
}

function renderDependencyText(deps) {
  if (!deps.length) {
    dependencyList.textContent = "No dependencies detected in this input.";
    return;
  }
  dependencyList.textContent = deps
    .map((d) => `- ${d.source} -> ${d.target} (${d.reason})`)
    .join("\n");
}

function readFilesAsText(files) {
  const promises = Array.from(files).map(
    (f) =>
      new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error(`Could not read file: ${f.name}`));
        reader.readAsText(f);
      })
  );
  return Promise.all(promises).then((chunks) => chunks.join("\n---\n"));
}

function downloadFile(data, fileName, mimeType) {
  const blob = new Blob([data], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function exportGraphAsPng() {
  if (!cy) {
    alert("Build a graph first before exporting.");
    return;
  }
  const pngDataUrl = cy.png({
    full: true,
    scale: 2,
    bg: "#ffffff"
  });

  const link = document.createElement("a");
  link.href = pngDataUrl;
  link.download = "k8s-dependency-graph.png";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function exportGraphAsSvg() {
  if (!cy) {
    alert("Build a graph first before exporting.");
    return;
  }

  // quick manual SVG export so we don't need extra plugins
  const width = 1200;
  const height = 900;
  const eles = cy.elements();
  const bbox = eles.boundingBox();
  const padding = 80;
  const usableW = width - padding * 2;
  const usableH = height - padding * 2;
  const graphW = Math.max(1, bbox.w);
  const graphH = Math.max(1, bbox.h);
  const scale = Math.min(usableW / graphW, usableH / graphH);

  function project(pos) {
    return {
      x: padding + (pos.x - bbox.x1) * scale,
      y: padding + (pos.y - bbox.y1) * scale
    };
  }

  const edgeParts = [];
  cy.edges().forEach((edge) => {
    const src = project(edge.source().position());
    const tgt = project(edge.target().position());
    const label = String(edge.data("label") || "");
    const midX = (src.x + tgt.x) / 2;
    const midY = (src.y + tgt.y) / 2;

    edgeParts.push(
      `<line x1="${src.x.toFixed(2)}" y1="${src.y.toFixed(2)}" x2="${tgt.x.toFixed(2)}" y2="${tgt.y.toFixed(2)}" stroke="#94a3b8" stroke-width="2" />`
    );

    if (label) {
      edgeParts.push(
        `<text x="${midX.toFixed(2)}" y="${(midY - 6).toFixed(2)}" text-anchor="middle" font-size="10" fill="#475569">${escapeXml(label)}</text>`
      );
    }
  });

  const nodeParts = [];
  cy.nodes().forEach((node) => {
    const p = project(node.position());
    const label = String(node.data("label") || "").split("\n");

    nodeParts.push(
      `<circle cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="22" fill="#38bdf8" stroke="#0f172a" stroke-width="1" />`
    );
    nodeParts.push(
      `<text x="${p.x.toFixed(2)}" y="${(p.y + 34).toFixed(2)}" text-anchor="middle" font-size="11" fill="#0f172a">${escapeXml(label.join(" "))}</text>`
    );
  });

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#ffffff" />
  ${edgeParts.join("\n  ")}
  ${nodeParts.join("\n  ")}
</svg>`;

  downloadFile(svg, "k8s-dependency-graph.svg", "image/svg+xml;charset=utf-8");
}

function escapeXml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function runBuilder() {
  try {
    let textBlob = yamlText.value.trim();
    if (!textBlob && fileInput.files && fileInput.files.length > 0) {
      textBlob = await readFilesAsText(fileInput.files);
    }

    if (!textBlob) {
      alert("Please paste YAML or upload at least one file.");
      return;
    }

    const docs = parseYamlDocuments(textBlob);
    const resources = docs.filter(isK8sObject);
    const deps = detectDependencies(resources);

    drawGraph(resources, deps);
    updateStats(resources, deps);
    renderDependencyText(deps);
  } catch (err) {
    console.error(err);
    alert(err.message || "Unexpected error while building graph.");
  }
}

// Sample YAML for demo :)
function loadSampleYaml() {
  yamlText.value = `apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
  namespace: demo
data:
  LOG_LEVEL: debug
---
apiVersion: v1
kind: Secret
metadata:
  name: app-secret
  namespace: demo
type: Opaque
stringData:
  password: pass123
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  namespace: demo
spec:
  replicas: 1
  selector:
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: web
    spec:
      containers:
        - name: web
          image: nginx
          envFrom:
            - configMapRef:
                name: app-config
            - secretRef:
                name: app-secret
---
apiVersion: v1
kind: Service
metadata:
  name: web-svc
  namespace: demo
spec:
  selector:
    app: web
  ports:
    - port: 80
      targetPort: 80
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: web-ing
  namespace: demo
spec:
  rules:
    - host: demo.local
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: web-svc
                port:
                  number: 80`;
}

function clearGraph() {
  yamlText.value = "";
  fileInput.value = "";
  dependencyList.textContent = "None yet.";
  nodeCountEl.textContent = "Nodes: 0";
  edgeCountEl.textContent = "Edges: 0";
  docCountEl.textContent = "Resources: 0";
  if (cy) {
    cy.destroy();
    cy = null;
  }
}

buildGraphBtn.addEventListener("click", runBuilder);
sampleBtn.addEventListener("click", loadSampleYaml);
clearBtn.addEventListener("click", clearGraph);
exportPngBtn.addEventListener("click", exportGraphAsPng);
exportSvgBtn.addEventListener("click", exportGraphAsSvg);

// little convenience so page isn't empty -->
loadSampleYaml();
runBuilder();
