# Party Monopoly online server (Colyseus) — deploys on Railway.
# The workspace packages (engine/ai/types) export their TypeScript source, so the
# server runs directly under tsx with no build step; a plain `npm install` links
# the workspaces and pulls tsx.
FROM node:20-slim
WORKDIR /app

# copy the repo (node_modules/dist excluded via .dockerignore) and install
COPY . .
RUN npm install --no-audit --no-fund

# Railway injects PORT; index.ts reads process.env.PORT (falls back to 2567)
CMD ["npm", "run", "start", "--workspace", "@party-monopoly/server"]
