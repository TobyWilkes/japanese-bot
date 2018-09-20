var Discord = require('discord.io');
var logger = require('winston');
var auth = require('./config.json');

var redis = require('redis');
var redisClient = redis.createClient(); 

// Configure logger settings
logger.remove(logger.transports.Console);
logger.add(new logger.transports.Console, {
    colorize: true
});
logger.level = 'debug';  

// Initialize Discord Bot
var bot = new Discord.Client({
   token: auth.bot_token,
   autorun: true
});

redisClient.on('error', function (err) {
    console.log('Something went wrong connecting to redis ' + err);
});

bot.on('ready', function (evt) {
    logger.info('Connected');
    logger.info('Logged in as: ');
    logger.info(bot.username + ' - (' + bot.id + ')');
});

function updateRanks(server_id, language) {
    redisClient.zrange(`${server_id}.roles.power`, 0, -1, (error, ranks) => {
        let member_count = bot.servers[server_id].member_count;
        let rank_count = ranks.length;

        let out = "";
        let prev = 0;

        for(let i = 0; i < ranks.length; i++) {
            let percentile = Math.ceil((Math.pow(2.7, ranks.length - i - 1) / Math.pow(2.7, ranks.length)) * member_count);

            if(prev == percentile)
                return;

            redisClient.zrange(`${server_id}.rank.${language}`, prev, percentile, (error, result) => {    
                console.log(`Applying role ${ranks[i]} to ${result.length} people. ${language}. Percentile from ${prev} to ${percentile}`);
                result.forEach(userID => {
                    console.log(userID);
                    bot.addToRole({
                        "serverID": server_id,
                        "userID": userID,
                        "roleID": ranks[i]
                    });
                });
            });
            
            prev = percentile;
            out += percentile + ", ";
        }

        console.log(out);
    });
}

redisClient.on('connect', function() {
    console.log('Redis client connected');

    bot.on('message', function (user, userID, channelID, message, evt) {
        let server_id = evt.d.guild_id;
        let user_roles = evt.d.member.roles;

        if(evt.d.author.bot == true)
            return;
        
        if (message.substring(0, 1) == '!') {
            redisClient.get(`${server_id}.roles.commands`, (error, result) => {
                var args = message.substring(1).split(' ');
                var cmd = args[0];
                
                args = args.splice(1);

                switch(cmd) {
                    case 'learning':
                        redisClient.mget(`${server_id}.roles.en_trigger`, `${server_id}.roles.ja_trigger`, (error, results) => {
                            let targetUser = userID;

                            if(args.length == 2) {
                                if(result !== null && user_roles.indexOf(result) == -1 || result == null) {
                                    // Member commands finished
                                    console.log("not an admin, tried to set user role");
                                    return;
                                } else {
                                    console.log("targeting ", args[1]);
                                    targetUser = args[1];
                                }
                            }
                            console.log(args.length, args, "setting role")

                            if(args[0].toLowerCase() == "english") {
                                bot.addToRole({
                                    "serverID": server_id,
                                    "userID": targetUser,
                                    "roleID": results[0]
                                });
                                bot.removeFromRole({
                                    "serverID": server_id,
                                    "userID": targetUser,
                                    "roleID": results[1]
                                });
                            } else if(args[0].toLowerCase() == "japanese") {
                                bot.addToRole({
                                    "serverID": server_id,
                                    "userID": targetUser,
                                    "roleID": results[1]
                                });
                                bot.removeFromRole({
                                    "serverID": server_id,
                                    "userID": targetUser,
                                    "roleID": results[0]
                                });
                            } else if(args[0].toLowerCase() == "both") {
                                bot.addToRole({
                                    "serverID": server_id,
                                    "userID": targetUser,
                                    "roleID": results[0]
                                });
                                bot.addToRole({
                                    "serverID": server_id,
                                    "userID": targetUser,
                                    "roleID": results[1]
                                });
                            }
                        });
                    break;
                }

                if(result !== null && user_roles.indexOf(result) == -1 || result == null) {
                    // Member commands finished
                    console.log("not an admin")
                    return;
                }

                // Admin commands
                switch(cmd) {
                    case 'listserverroles':
                        let output = "";
                        Object.keys(bot.servers[evt.d.guild_id].roles).forEach((role) => {
                            output += `${role} ${JSON.stringify(bot.servers[evt.d.guild_id].roles[role])} \n\n`;
                        });

                        bot.sendMessage({
                            to: channelID,
                            message: output
                        });
                    break;
                    case 'serverrank':
                        redisClient.zrange(`${server_id}.rank.en`, 0, 100, "WITHSCORES", (error, result) => {
                            bot.sendMessage({
                                to: channelID,
                                message: `\`\`\`English:
                                    ${JSON.stringify(result)}
                                \`\`\``
                            })
                        });
                        redisClient.zrange(`${server_id}.rank.ja`, 0, 100, "WITHSCORES", (error, result) => {
                            bot.sendMessage({
                                to: channelID,
                                message: `\`\`\`Japanese:
                                    ${JSON.stringify(result)}
                                \`\`\``
                            })
                        });
                    break;
                    case 'listroles':
                        redisClient.multi()
                        .zrange(`${server_id}.roles.power`, 0, -1)
                        .mget(`${server_id}.roles.en_trigger`, `${server_id}.roles.ja_trigger`, `${server_id}.roles.commands`, (error, results) => {
                        })
                        .exec((error, results) => {
                            reply = "Speak Roles: ";
                            console.log(results);
                            results[0].forEach((result, i) => {
                                reply += result + ((i < results.length) ? ", " : "");    
                            });
                            reply += `\nEn Role: ${results[1][0]}`;
                            reply += `\nJa Role: ${results[1][1]}`;
                            reply += `\nCommands Role: ${results[1][2]}`;
                            bot.sendMessage({
                                to: channelID,
                                message: reply
                            });
                        });
                    break;
                    case 'setroles':
                        switch(args[0]) {
                            case "power_roles":
                                let insertRoles = [];
                                console.log(args);
                                args.splice(1).forEach((role, i) => {
                                    insertRoles.push(i);
                                    insertRoles.push(role);
                                });
                                redisClient.multi()
                                .del(`${server_id}.roles.power`)
                                .zadd(`${server_id}.roles.power`, ...insertRoles, redis.print)
                                .exec();
                            break;
                            case "en_trigger_role":
                                redisClient.set(`${server_id}.roles.en_trigger`, args[1], redis.print);
                            break;
                            case "ja_trigger_role":
                                redisClient.set(`${server_id}.roles.ja_trigger`, args[1], redis.print);
                            break; 
                            case "command_role":
                                redisClient.set(`${server_id}.roles.commands`, args[1], redis.print);
                            break;
                            default:
                                bot.sendMessage({
                                    to: channelID,
                                    message: `Valid Roles are: power_roles en_trigger_role ja_trigger_role`
                                })
                                return;
                            break;
                        }
                        bot.sendMessage({
                            to: channelID,
                            message: "Roles Updated"
                        })
                    break;
                }
                return;
            });
        }

        let punc = ".,:!?_@></\\{}()[]&^%$#!~`'\";";
        let english = 0;
        let japanese = 0;
        
        for(let i = 0; i < message.length; i++) {
            code = message.charCodeAt(i);
            if (code > 47 && code < 58) {
                // Numeric
            } else if((code > 64 && code < 91) || (code > 96 && code < 123)) {
                // Alpha
                english++;
            } else if(punc.indexOf(message.charAt(i)) == -1) {
                japanese++;
            }
        };

        redisClient.mget(`${server_id}.roles.en_trigger`, `${server_id}.roles.ja_trigger`, (error, results) => {
            let en_trigger = results[0];
            let ja_trigger = results[1];

            if(user_roles.indexOf(en_trigger) >= 0) {
                redisClient.multi()
                .zincrby(`${server_id}.rank.en`, english, userID, (error, result) => {
                })
                .zrank(`${server_id}.rank.en`, userID, (error, result) => {
                    /*console.log(result);
                    bot.sendMessage({
                        to: channelID,
                        message: `${userID} rank en #${result+1}`
                    });*/
                    updateRanks(server_id, "en");
                })
                .exec();
            }

            if(user_roles.indexOf(ja_trigger) >= 0) {
                redisClient.multi()
                .zincrby(`${server_id}.rank.ja`, japanese, userID, (error, result) => {
                })
                .zrank(`${server_id}.rank.ja`, userID, (error, result) => {
                    /*console.log(result);
                    bot.sendMessage({
                        to: channelID,
                        message: `${userID} rank ja #${result+1}`
                    });*/
                    updateRanks(server_id, "ja");
                })
                .exec();
            }
        });
    });
});