FROM node:20-alpine
WORKDIR /app
# sem dependências externas: só os três arquivos do painel
COPY extrair-clickup.mjs servidor.mjs painel.html ./
ENV PORT=3000
EXPOSE 3000
USER node
CMD ["node", "servidor.mjs"]
