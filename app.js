require('dotenv').config({silent: true});

var builder = require('botbuilder');
var moment = require('moment-timezone');
var prompts = require('./prompts');
var restify = require('restify');
var R = require('ramda');
var client = require('./client');

const USER_TIMEZONE = 'America/New_York';

moment.updateLocale('en', {
  relativeTime: {
    future: "in approximately %s",
    past: "%s ago",
    m: "1 minute",
    h: "1 hour",
    d: "1 day",
    M: "1 month",
    y: "1 year"
  }
});

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

intent.onBegin((session, args, next) => {
  const { message: { address, entities } } = session;
  if (address.channelId === 'slack' && address.conversation.isGroup) {
    const mentions = builder.EntityRecognizer.findAllEntities(entities, 'mention');
    const botName = address.bot.name
    const botMentions = R.filter((m) => m.mentioned.name === botName, mentions)
    if (botMentions.length === 0) {
      return session.endConversation();
    }
  }
  next(args);
});

/** Add global cancel action */
intent.endConversationAction('cancel', "Ok bye", {matches: /^(cancel|stop|end|quit|bye)/});

/** Answer help related questions like "what can I say?" */
intent.matches('help', answerHelp);
intent.onDefault(answerHelp);

intent.matches('bus_countdown', [cacheEntities, askBusId, askDirection, askStopQuery, answerBusCountdown])
intent.matches('bus_location', [cacheEntities, askBusId, askDirection, askStopQuery, answerBusCountdown])
intent.matches('stop_location', [cacheEntities, askStopQuery, answerStopLocation])

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
  (session, args, next) => {
    if (session.privateConversationData.stopQuery) {
      next({ response: session.privateConversationData.stopQuery });
    } else {
      builder.Prompts.text(session, prompts.stopQueryUnknown);
    }
  },
  (session, results, next) => {
    if (results && results.response) {
      var query = results.response;

      client.geocode({ query }, (err, response) => {
        if (err) {
          console.log("[error][geocode] ", err);
          delete session.privateConversationData.stopQuery
          session.send("Failed to fetch results with your query: ", query);
          session.replaceDialog('/getStopQuery');
          return;
        }

        console.log("[info][geocode] ", response.geocodes)

        if (response.geocodes.length === 0 || response.geocodes[0].address.startsWith("Rhode Island, USA")) {
          delete session.privateConversationData.stopQuery
          session.send("No results found for: %(query)s", {query});
          session.replaceDialog('/getStopQuery');
          return;
        }

        if (response.geocodes.length === 1) {
          session.privateConversationData['stopQueryLocation'] = response.geocodes[0];
        }

        session.privateConversationData['geocodes'] = R.indexBy(R.prop('address'), response.geocodes)
        session.beginDialog('/getStopsByLocation')
      })
    } else {
      session.replaceDialog('/getStopQuery');
    }
  }
]);

bot.dialog('/getStopsByLocation', [
  (session, args, next) => {
    if (session.privateConversationData.stopQueryLocation) {
      next({
        response: {
          entity: session.privateConversationData.stopQueryLocation.address
        }
      });
    } else {
      builder.Prompts.choice(session, "Multiple posible locations found. Please select one", session.privateConversationData.geocodes);
    }
  },
  (session, results, next) => {
    if (results && results.response) {
      var location = session.privateConversationData['stopQueryLocation'] = session.privateConversationData.geocodes[results.response.entity];
      const { busId, busDirection } = session.privateConversationData;

      var queryRequest = {
        route: busId,
        lat: location.lat,
        long: location.long
      };

      if (busDirection) {
        var direction = "0";
        if (/^(outbound|n|north|e|east)$/.test(busDirection.toLowerCase())) {
          direction = "1";
        }
        queryRequest.direction = direction;
      }


      client.getStopsByLocation(queryRequest, function(err, response) {
        if (err) {
          console.log("[error][stop_query] ", err);
          session.send("Failed to locate stops within this area: %(address)s", {address: location.address});
          delete session.privateConversationData.stopQuery;
          delete session.privateConversationData.stopQueryLocation;
          session.replaceDialog('/getStopQuery');
          return;
        }

        var stops = response.stop
        session.privateConversationData['stops'] = R.indexBy(R.prop('name'), stops)

        if (stops.length == 0) {
          session.send("No stops are located near %(address)s for bus %(busId)s", {address: location.address, busId})
          delete session.privateConversationData.stopQuery;
          delete session.privateConversationData.stopQueryLocation;
          session.replaceDialog('/getStopQuery')
          return;
        }

        if (stops.length == 1) {
          session.privateConversationData['stop'] = stops[0]
        }

        session.beginDialog('/getStopId')
      })
    } else {
      session.replaceDialog('/getStopsByLocation');
    }
  }
]);

bot.dialog('/getStopId', [
  (session, args, next) => {
    if (session.privateConversationData.stop) {
      next({response: { entity: session.privateConversationData.stop.name }});
    } else {
      builder.Prompts.choice(session, "Multiple stops found nearby. Please select one", session.privateConversationData.stops);
    }
  },
  (session, results, next) => {
    if (results && results.response) {
      session.privateConversationData['stop'] = session.privateConversationData.stops[results.response.entity];
      next();
    } else {
      session.replaceDialog('/getStopId')
    }
  }
]);

function cacheEntities(session, args, next) {
  var busId= builder.EntityRecognizer.findEntity(args.entities, 'bus_id');
  var busDirection= builder.EntityRecognizer.findEntity(args.entities, 'bus_direction');
  var stopQuery= builder.EntityRecognizer.findEntity(args.entities, 'stop_query');

  session.privateConversationData.entities = {
    busId,
    busDirection,
    stopQuery
  }

  next(args)
}

function askBusId(session, args, next) {
  var busId;
  var entity = session.privateConversationData.entities.busId;
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
  var entity = session.privateConversationData.entities.busDirection;
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
  var stopQuery;
  var entity = session.privateConversationData.entities.stopQuery;
  if (entity && entity.entity) {
    stopQuery = entity.entity
  } else if (session.privateConversationData.stopQuery) {
    stopQuery = session.privateConversationData.stopQuery
  }

  session.privateConversationData.stopQuery = stopQuery
  session.beginDialog('/getStopQuery')
}

function answerBusCountdown(session, results) {
  const { busId, busDirection, stopQueryLocation, stop } = session.privateConversationData;

  var stopsByStopIdRequest = {
    routeId: busId,
    stopId: stop.id
  };

  client.routeStopsByStopId(stopsByStopIdRequest, function(err, response) {
    if (err) {
      session.send("Failed to find bus information. Please try again later.");
      session.endConversation();
      return;
    }

    var stops = response.stop;
    if (stops.length === 0) {
      session.send("No buses will be arriving any time soon at that stop.")
      session.endConversation()
      return
    }

    session.send("The %(busId)s %(busDirection)s will get to %(stopName)s %(time)s (scheduled %(scheduleTime)s)", {
      busId: busId,
      busDirection: busDirection,
      scheduleTime: moment(stops[0].time.scheduleTime).tz(USER_TIMEZONE).format("h:mma"),
      stopName: stop.name ,
      time: moment(stops[0].time.arrivalTime).tz(USER_TIMEZONE).fromNow()
    });
    session.endConversation();
  });
}

function answerStopLocation(session, results) {
  const { stop, stopQueryLocation } = session.privateConversationData;
  session.send("Getting nearest stop. stopQuery=%(stopQuery)s stopName=%(stopName)s", {
    stopQuery: stopQueryLocation.address,
    stopName: stop.name
  });
  session.endConversation();
}

function answerHelp(session, args, next) {
  session.send(prompts.helpMessage);
  session.endConversation();
}
