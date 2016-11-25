FROM node:6

Add . /app
WORKDIR /app

# install node packages
RUN npm install

EXPOSE 3978

CMD ["npm", "start"]
