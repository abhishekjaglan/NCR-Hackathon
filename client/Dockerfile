FROM node:20-alpine

WORKDIR /app

COPY client/package*.json ./
RUN npm install

COPY client/ ./

COPY server/ ./server/

WORKDIR /app/server
RUN npm install
RUN npm run build

WORKDIR /app
RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]