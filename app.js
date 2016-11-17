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
var bot = new builder.UniversalBot(connector);

server.post('/api/messages', connector.listen());

var model = process.env.LUIS_MODEL || 'https://api.projectoxford.ai/luis/v2.0/apps/ef678a37-c704-40f8-a952-06902a4599f7?subscription-key=1de93e00db2e4d128168115876e5391e&q=';
var recognizer = new builder.LuisRecognizer(model);
var intent = new builder.IntentDialog({ recognizers: [recognizer] });
bot.dialog('/', intent);

/** Answer help related questions like "what can I say?" */
intent.matches('help', builder.DialogAction.send(prompts.helpMessage));
intent.onDefault(builder.DialogAction.send(prompts.helpMessage));

intent.matches('bus_countdown', [askBusId, answerBusCountdown])

function askBusId(session, args, next) {
  var busId;
  var entity = builder.EntityRecognizer.findEntity(args.entities, 'bus_id');
  if (entity && entity.entity) {
    busId = entity.entity
  } else if (session.dialogData.busId) {
    busId = session.dialogData.busId;
  }

  if (!busId) {
    builder.Prompts.text(session, prompts.busIdUnknown);
  } else {
    next({ response: busId })
  }
}

function answerBusCountdown(session, results) {
  if (results.response) {
    const busId = session.dialogData.busId = results.response;
    const answer = { busId };
    session.send("Here is your question details: busId=%(busId)s", answer);
  } else {
    session.send("failed to find bus id");
  }
}
