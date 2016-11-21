require('dotenv').config()

var builder = require('botbuilder');
var prompts = require('./prompts');
var restify = require('restify');

var server = restify.createServer();
server.listen(process.env.PORT || 3978, () => {
  console.log("%s listening on %s", server.name, server.url);
});

var connector = new builder.ChatConnector({
  appId: process.env.APP_ID,
  appPassword: process.env.APP_PASSWORD
});
var bot = new builder.UniversalBot(connector, {
  persistConversationData: false
});

server.post('/api/messages', connector.listen());

var model = process.env.LUIS_MODEL || 'https://api.projectoxford.ai/luis/v2.0/apps/ef678a37-c704-40f8-a952-06902a4599f7?subscription-key=1de93e00db2e4d128168115876e5391e&q=';
var recognizer = new builder.LuisRecognizer(model);
var intent = new builder.IntentDialog({ recognizers: [recognizer] });
bot.dialog('/', intent);

/** Answer help related questions like "what can I say?" */
intent.matches('help', builder.DialogAction.send(prompts.helpMessage));
intent.onDefault(builder.DialogAction.send(prompts.helpMessage));

intent.matches('bus_countdown', [askBusId, askDirection, askStopQuery, answerBusCountdown])
intent.matches('bus_location', [askBusId, askDirection, askStopQuery, answerBusCountdown])

bot.dialog('/getBusId', [
  (session) => {
    builder.Prompts.text(session, prompts.busIdUnknown);
  },
  (session, results, next) => {
    if (results && results.response) {
      session.privateConversationData['busId'] = results.response;
      next();
    } else {
      session.replaceDialog('/getBusId');
    }

  }
]);

bot.dialog('/getBusDirection', [
  (session) => {
    builder.Prompts.text(session, prompts.busDirectionUnknown);
  },
  (session, results, next) => {
    if (results && results.response) {
      session.privateConversationData['busDirection'] = results.response;
      next();
    } else {
      session.replaceDialog('/getBusDirection');
    }
  }
]);

bot.dialog('/getStopQuery', [
  (session) => {
    builder.Prompts.text(session, prompts.stopQueryUnknown);
  },
  (session, results, next) => {
    if (results && results.response) {
      session.privateConversationData['stopQuery'] = results.response;
      next();
    } else {
      session.replaceDialog('/getStopQuery');
    }
  }
]);

function askBusId(session, args, next) {
  var busId;
  var entity = builder.EntityRecognizer.findEntity(args.entities, 'bus_id');
  if (entity && entity.entity) {
    busId = entity.entity
  } else if (session.privateConversationData.busId) {
    busId = session.privateConversationData.busId
  }

  if (!busId) {
    session.beginDialog('/getBusId')
  } else {
    session.privateConversationData.busId = busId
    next(args);
  }
}

function askDirection(session, args, next) {
  var busDirection;
  var entity = builder.EntityRecognizer.findEntity(args.entities, 'bus_direction');
  if (entity && entity.entity) {
    busDirection = entity.entity
  } else if (session.privateConversationData.busDirection) {
    busDirection = session.privateConversationData.busDirection
  }

  if (!busDirection) {
    session.beginDialog('/getBusDirection')
  } else {
    session.privateConversationData.busDirection = busDirection
    next(args);
  }
}

function askStopQuery(session, args, next) {
  console.log("ARGS: ", args)
  var stopQuery;
  var entity = builder.EntityRecognizer.findEntity(args.entities, 'stop_query');
  if (entity && entity.entity) {
    stopQuery = entity.entity
  } else if (session.privateConversationData.stopQuery) {
    stopQuery = session.privateConversationData.stopQuery
  }

  if (!stopQuery) {
    session.beginDialog('/getStopQuery')
  } else {
    session.privateConversationData.stopQuery = stopQuery
    next(args);
  }
}

function answerBusCountdown(session, results) {
  const { busId, busDirection, stopQuery } = session.privateConversationData;
  session.send("Understood entities: busId=%(busId)s busDirection=%(busDirection)s stopQuery=%(stopQuery)s", {
    busId,
    busDirection,
    stopQuery
  });
  session.endConversation();
}
