"use strict";

var Promise = require("bluebird");
var rp = require("request-promise");
var path = require("path");
var fs = require("fs");

var schema = JSON.parse(fs.readFileSync(path.join(__dirname, "../", "schema", "events-response.schema.json"), "utf8"));

var EventSearch = function (options) {

    var self = this,
        allowedSorts = ["time", "distance", "venue", "popularity"];

    self.latitude = options.lat || null;
    self.longitude = options.lng || null;
    self.distance = options.distance || 100;
    self.limit = options.limit || 100;
    self.accessToken = options.accessToken ? options.accessToken : (process.env.FEBL_ACCESS_TOKEN && process.env.FEBL_ACCESS_TOKEN !== "" ? process.env.FEBL_ACCESS_TOKEN : null);
    self.query = options.query ? encodeURIComponent(options.query) : "";
    self.sort = options.sort ? (allowedSorts.indexOf(options.sort.toLowerCase()) > -1 ? options.sort.toLowerCase() : null) : null;
    self.version = options.version ? options.version : "v2.8";
    self.since = options.since || (new Date().getTime()/1000).toFixed();
    self.until = options.until || null;
    self.eventId = null;
    self.latLanArray = options.latLanArray || null;
    self.venueIdArray = options.venueIdArray || null;
    self.eventIdArray = options.eventIdArray || null;
    self.schema = schema;

};

EventSearch.prototype.calculateStarttimeDifference = function (currentTime, dataString) {
    return (new Date(dataString).getTime()-(currentTime*1000))/1000;
};

EventSearch.prototype.compareVenue = function (a,b) {
    if (a.venue.name < b.venue.name)
        return -1;
    if (a.venue.name > b.venue.name)
        return 1;
    return 0;
};

EventSearch.prototype.compareTimeFromNow = function (a,b) {
    if (a.timeFromNow < b.timeFromNow)
        return -1;
    if (a.timeFromNow > b.timeFromNow)
        return 1;
    return 0;
};

EventSearch.prototype.compareDistance = function (a,b) {
    var aEventDistInt = parseInt(a.distance, 10);
    var bEventDistInt = parseInt(b.distance, 10);
    if (aEventDistInt < bEventDistInt)
        return -1;
    if (aEventDistInt > bEventDistInt)
        return 1;
    return 0;
};

EventSearch.prototype.comparePopularity = function (a,b) {
    if ((a.stats.attending + (a.stats.maybe / 2)) < (b.stats.attending + (b.stats.maybe / 2)))
        return 1;
    if ((a.stats.attending + (a.stats.maybe / 2)) > (b.stats.attending + (b.stats.maybe / 2)))
        return -1;
    return 0;
};

EventSearch.prototype.haversineDistance = function (coords1, coords2, isMiles) {

    //coordinate is [latitude, longitude]
    function toRad(x) {
        return x * Math.PI / 180;
    }

    var lon1 = coords1[1];
    var lat1 = coords1[0];

    var lon2 = coords2[1];
    var lat2 = coords2[0];

    var R = 6371; // km

    var x1 = lat2 - lat1;
    var dLat = toRad(x1);
    var x2 = lon2 - lon1;
    var dLon = toRad(x2);
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    var d = R * c;

    if(isMiles) d /= 1.60934;

    return d;

};

EventSearch.prototype.search = function () {

    var self = this;

    return new Promise(function (resolve, reject) {

         if (!self.latLanArray) {
            var error = {
                "message": "Please specify the lat and lng parameters!",
                "code": 1
            };
            console.error(JSON.stringify(error));
            reject(error);
        }
         //else
        // if (!self.accessToken) {
        //     var error = {
        //         "message": "Please specify an Access Token, either as environment variable or as accessToken parameter!",
        //         "code": 2
        //     };
        //     console.error(JSON.stringify(error));
        //     reject(error);
        //else
        else {
            var count=0;
            var latLanArray = self.latLanArray.split(',');
            for(var i=0;i<latLanArray.length - 1; i=i+2){
              self.latitude = latLanArray[i];
              self.longitude = latLanArray[i+1];
              var events = [];
                var idLimit = 50, //FB only allows 50 ids per /?ids= call
                    currentTimestamp = (new Date().getTime()/1000).toFixed(),
                    venuesCount = 0,
                    venuesWithEvents = 0,
                    eventsCount = 0,
                    placeUrl = "https://graph.facebook.com/" + self.version + "/search" +
                        "?type=place" +
                        "&q=" + self.query +
                        "&center=" + self.latitude + "," + self.longitude +
                        "&distance=" + self.distance +
                        "&limit=" + self.limit +
                        "&fields=id" +
                        "&access_token=" + self.accessToken;
                        console.error(placeUrl);

                //Get places as specified
                rp.get(placeUrl).then(function(responseBody) {

                    var ids = [],
                        tempArray = [],
                        data = JSON.parse(responseBody).data;

                    //Set venueCount
                    venuesCount = data.length;

                    //Create array of 50 places each
                    data.forEach(function(idObj, index, arr) {
                        tempArray.push(idObj.id);
                        if (tempArray.length >= idLimit) {
                            ids.push(tempArray);
                            tempArray = [];
                        }
                    });

                    // Push the remaining places
                    if (tempArray.length > 0) {
                        ids.push(tempArray);
                    }

                    return ids;
                }).then(function(ids) {

                    var urls = [];

                    //Create a Graph API request array (promisified)
                    ids.forEach(function(idArray, index, arr) {
                        var eventsFields = [
                            "id",
                            "type",
                            "name",
                            "cover.fields(id,source)",
                            "picture.type(large)",
                            "description",
                            "start_time",
                            "end_time",
                            "category",
                            "place",
                            "attending_count",
                            "declined_count",
                            "maybe_count",
                            "noreply_count"
                        ];
                        var fields = [
                            "id",
                            "name",
                            "about",
                            "emails",
                            "cover.fields(id,source)",
                            "picture.type(large)",
                            "location",
                            "events.fields(" + eventsFields.join(",") + ")"
                        ]
                        var eventsUrl = "https://graph.facebook.com/" + self.version + "/" +
                            "?ids=" + idArray.join(",") +
                            "&access_token=" + self.accessToken +
                            "&fields=" + fields.join(",") +
                            ".since(" + self.since + ")";
                        if (self.until) {
                            eventsUrl += ".until(" + self.until + ")";
                        }
                        urls.push(rp.get(eventsUrl));
                    });

                    return urls;

                }).then(function(promisifiedRequests) {

                    //Run Graph API requests in parallel
                    return Promise.all(promisifiedRequests)

                }).then(function(results){
                    //Handle results
                    count = count+2;
                    results.forEach(function(resStr, index, arr) {
                        var resObj = JSON.parse(resStr);
                        Object.getOwnPropertyNames(resObj).forEach(function(venueId, index, array) {
                            var venue = resObj[venueId];
                            if (venue.events && venue.events.data.length > 0) {
                                venuesWithEvents++;
                                venue.events.data.forEach(function(event, index, array) {
                                    var eventResultObj = {};
                                    eventResultObj.id = event.id;
                                    eventResultObj.name = event.name;
                                    eventResultObj.type = event.type;
                                    eventResultObj.coverPicture = (event.cover ? event.cover.source : null);
                                    eventResultObj.profilePicture = (event.picture ? event.picture.data.url : null);
                                    eventResultObj.description = (event.description ? event.description : null);
                                    eventResultObj.distance = (venue.location ? (self.haversineDistance([venue.location.latitude, venue.location.longitude], [self.latitude, self.longitude], false)*100000).toFixed() : null);
                                    eventResultObj.startTime = (event.start_time ? event.start_time : null);
                                    eventResultObj.endTime = (event.end_time ? event.end_time : null);
                                    eventResultObj.timeFromNow = self.calculateStarttimeDifference(currentTimestamp, event.start_time);
                                    eventResultObj.category = (event.category ? event.category : null);
                                    eventResultObj.stats = {
                                        attending: event.attending_count,
                                        declined: event.declined_count,
                                        maybe: event.maybe_count,
                                        noreply: event.noreply_count
                                    };
                                    eventResultObj.venue = {};
                                    eventResultObj.venue.id = venueId;
                                    eventResultObj.venue.name = venue.name;
                                    eventResultObj.venue.about = (venue.about ? venue.about : null);
                                    eventResultObj.venue.emails = (venue.emails ? venue.emails : null);
                                    eventResultObj.venue.coverPicture = (venue.cover ? venue.cover.source : null);
                                    eventResultObj.venue.profilePicture = (venue.picture ? venue.picture.data.url : null);
                                    eventResultObj.venue.location = (venue.location ? venue.location : null);
                                    events.push(eventResultObj);
                                    eventsCount++;
                                });
                            }
                        });
                    });
                    //Sort if requested
                    if (self.sort) {
                        switch (self.sort) {
                            case "time":
                                events.sort(self.compareTimeFromNow);
                                break;
                            case "distance":
                                events.sort(self.compareDistance);
                                break;
                            case "venue":
                                events.sort(self.compareVenue);
                                break;
                            case "popularity":
                                events.sort(self.comparePopularity);
                                break;
                            default:
                                break;
                        }
                    }
                    //Produce result object

                }).then(function(results){

                  if(count>=latLanArray.length){
                      resolve({events:events});
                    }
                }).catch(function (e) {
                    var error = {
                        "message": e,
                        "code": -1
                    };
                    console.error(JSON.stringify(error));
                    reject(error);
                });
            }
         }
        });
    };
    module.exports = EventSearch;

    EventSearch.prototype.getSchema = function () {
        return this.schema;
    };

     EventSearch.prototype.searchbyid = function () {
         var self = this;
        //   if (!self.latLanArray) {
        //      var error = {
        //          "message": "Please specify the lat and lng parameters!",
        //          "code": 1
        //      };
        //      console.error(JSON.stringify(error));
        //      reject(error);
        //  }
        //  else
        return new Promise(function (resolve, reject) {
          var events = [];
             var count=0;
             var venueDetail;
             var venueIdArray = self.venueIdArray.split(',');
             var eventIdArray = self.eventIdArray.split(',');
             for(var i=0;i<venueIdArray.length; i++){
               var events = [];
               self.eventId = eventIdArray[i];
                 var idLimit = 50, //FB only allows 50 ids per /?ids= call
                     currentTimestamp = (new Date().getTime()/1000).toFixed(),
                     venuesCount = 0,
                     venuesWithEvents = 0,
                     eventsCount = 0,
                     placeUrl = "https://graph.facebook.com/" + self.version +
                          "/"+venueIdArray[i] +
                         "?fields=id,cover,about,name" +
                         "&access_token=" + self.accessToken;
                         //console.error(placeUrl);
                 //Get places as specified
                 rp.get(placeUrl).then(function(responseBody) {
                    venueDetail = JSON.parse(responseBody);
                     //Set venueCount
                     //console.error(venueDetail);
                     return venueDetail;
                 }).then(function(venueDetail) {
                   var urls = [];
                    var fields = [       "id",
                                          "type",
                                          "name",
                                          "cover.fields(id,source)",
                                          "picture.type(large)",
                                          "description",
                                          "start_time",
                                          "end_time",
                                          "category",
                                          "attending_count",
                                          "declined_count",
                                          "maybe_count",
                                          "noreply_count",
                                          "place"

                                      ];
                             var eventsUrl = "https://graph.facebook.com/" + self.version +
                                  "/"+self.eventId +
                                  "?fields=" + fields.join(",") +
                                 "&access_token=" + self.accessToken;
                                 urls.push(rp.get(eventsUrl));
                     return urls;

                 }).then(function(promisifiedRequests) {
                     //Run Graph API requests in parallel
                      return Promise.all(promisifiedRequests);

                 }).then(function(results){
                     //Handle results

                     count++;
                       var event = JSON.parse(results);

                                     var eventResultObj = {};
                                     eventResultObj.id = event.id;
                                     eventResultObj.name = event.name;
                                     eventResultObj.type = event.type;
                                     eventResultObj.coverPicture = (event.cover ? event.cover.source : null);
                                     eventResultObj.profilePicture = (event.picture ? event.picture.data.url : null);
                                     eventResultObj.description = (event.description ? event.description : null);
                                     eventResultObj.distance = (event.place.location ? (self.haversineDistance([event.place.location.latitude, event.place.location.longitude], [self.latitude, self.longitude], false)*100000).toFixed() : null);
                                     eventResultObj.startTime = (event.start_time ? event.start_time : null);
                                     eventResultObj.endTime = (event.end_time ? event.end_time : null);
                                     eventResultObj.timeFromNow = self.calculateStarttimeDifference(currentTimestamp, event.start_time);
                                     eventResultObj.category = (event.category ? event.category : null);
                                     eventResultObj.stats = {
                                         attending: event.attending_count,
                                         declined: event.declined_count,
                                         maybe: event.maybe_count,
                                         noreply: event.noreply_count
                                     };

                                     eventResultObj.venue = {};
                                     eventResultObj.venue.id = venueDetail.id;
                                     eventResultObj.venue.name = venueDetail.name;
                                     eventResultObj.venue.about = (venueDetail.about ? venueDetail.about : null);
                                     //eventResultObj.venue.emails = (venueDetail.emails ? venueDetail.emails : null);
                                     eventResultObj.venue.coverPicture = (venueDetail.cover ? venueDetail.cover.source : null);

                                     //eventResultObj.venue.profilePicture = (venueDetail.picture ? venueDetail.picture.data.url : null);
                                     eventResultObj.venue.location = (event.place ? event.place.location : null);


                                     events.push(eventResultObj);


                                     eventsCount++;


                     //Sort if requested
                     if (self.sort) {
                         switch (self.sort) {
                             case "time":
                                 events.sort(self.compareTimeFromNow);
                                 break;
                             case "distance":
                                 events.sort(self.compareDistance);
                                 break;
                             case "venue":
                                 events.sort(self.compareVenue);
                                 break;
                             case "popularity":
                                 events.sort(self.comparePopularity);
                                 break;
                             default:
                                 break;
                         }
                     }
                     return events;
                     //Produce result object

                 }).then(function(results){
                   console.error(count);
                   if(count>=venueIdArray.length){
                       resolve({events:events});
                     }
                 }).catch(function (e) {
                     var error = {
                         "message": e,
                         "code": -1
                     };
                     console.error(JSON.stringify(error));
                     Promise.reject(error);
                 });
             }
             });
     };
