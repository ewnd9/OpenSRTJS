var xmlrpc = require("xmlrpc");
var async = require("async");
var isNode = require('detect-node');

var _ = require('lodash');

var USER_AGENT;

var clientOptions = { host: 'api.opensubtitles.org', port: 80, path: '/xml-rpc'};

var client = xmlrpc.createClient(clientOptions);

if (!isNode) {
	var $ = jQuery = require('./bower_components/jquery/jquery.min.js');
  require('./bower_components/jquery-xmlrpc/jquery.xmlrpc.min.js');

	client = {
		methodCall: function(method, params, cb) {
	    $.xmlrpc({
	      url: 'http://' + clientOptions.host + clientOptions.path,
	      methodName: method,
	      params: params,
	      success: function(response, status, jqXHR) {
	        cb(null, response[0]);
	      },
	      error: function(jqXHR, status, error) {
	        cb(error);
	      }
	    });
	  }
	};
}

var token = "";

var OpenSRT = function(userAgent) {
	if(!userAgent) {
		throw new Error("User Agent must be supplied");
		return;
	}

	USER_AGENT = userAgent;

}

OpenSRT.prototype.getToken = function getToken(cb) {
	client.methodCall('LogIn', ['', '', 'en', USER_AGENT], function (err, res) {
		if(err) return cb(err, null);
		if(res.status === '414 Unknown User Agent') {
			throw new Error('Unknown User Agent');
			return;
		}
		token = res.token;
		cb(null, res.token);
  })
},

OpenSRT.prototype.searchEpisode = function(data, cb) {
	if(!data.token) {
		this.getToken(function(err, token) {
			if(err) {
				return cb(err, null);
			}
			data.token = token;
			return searchEpisode(data, cb);
		});
	}

	else {
		return searchEpisode(data, cb);
	}
}

function searchEpisode(data, cb) {
	var opts = {};
	opts.sublanguageid = "all";

	// Do a hash or filename check first (either), then fallback to imdb+season+episode
	if(data.hash) {
		opts.moviehash = hash;
	}
	if(!data.filename) {
		opts.imdbid = data.imdbid.replace("tt", "");
		opts.season = data.season;
		opts.episode = data.episode;
	}
	else {
		opts.tag = data.filename;
	}
	client.methodCall('SearchSubtitles', [
		data.token,
		[
			opts
		]
	],
	function(err, res){
		if(err  || typeof res.data === 'undefined') return cb(err, null);
		if(res.status === '414 Unknown User Agent') {
			throw new Error('Unknown User Agent');
			return;
		}
		var subs = {};
		async.eachSeries(res.data, function(sub, callback) {
			if(sub.SubFormat != "srt")  return callback();
			if(data.season && data.episode) {// definitely an episode check
				if(parseInt(sub.SeriesIMDBParent, 10) != parseInt(data.imdbid.replace("tt", ""), 10)) return callback();
				if(sub.SeriesSeason != data.season) return callback();
				if(sub.SeriesEpisode != data.episode) return callback();
			}
			var tmp = {};
			tmp.url = sub.SubDownloadLink.replace(".gz", ".srt");
			tmp.lang = sub.ISO639;
			tmp.downloads = parseInt(sub.SubDownloadsCnt);
			tmp.score = 0;
			tmp.subFilename = sub.SubFileName.trim();
			tmp.releaseFilename = sub.MovieReleaseName.trim();
			tmp.date = sub.SubAddDate;
			tmp.encoding = sub.SubEncoding;

			if(sub.MatchedBy == "moviehash") tmp.score += 100;
			if(sub.MatchedBy == "tag") tmp.score += 50;
			if(sub.UserRank == "trusted") tmp.score += 100;

			if(!subs[tmp.lang]) {
				subs[tmp.lang] = [tmp];
			} else {
				subs[tmp.lang].push(tmp);
			}
			return callback();
		},
		function(err) {
			// Do 1 extra query by imdb / season / episode in case no tag match for a lang
			if(!data.recheck && data.imdbid && data.season && data.episode) {
				return searchEpisode({
					imdbid: data.imdbid.replace("tt", ""),
					season: data.season,
					episode: data.episode,
					recheck: true,
					token: data.token
				}, cb);
			}
			else {
				// If score is 0 or equal, sort by downloads
				for (var lang in subs) {
					if (subs.hasOwnProperty(lang)) {
						subs[lang].sort(function(s1, s2) {
							if(s1.score > s2.score || (s1.score == s2.score && s1.downloads > s2.downloads)) {
								return -1;
							} else {
								return 1;
							}
						});
					}
				}

				return cb(err, subs);
			}
		})
	})
}

module.exports = OpenSRT;
