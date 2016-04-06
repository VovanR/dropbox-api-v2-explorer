(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
/* This file contains a module for functions that make calls to the API and their associated
   helper functions.
 */
var utils = require('./utils');
/* Listener functions for the API calls; since downloads have a non-JSON response, they need a
   separate listener.
 */
var JSONListener = function (component, resp) {
    var response = resp.responseText;
    if (resp.status !== 200) {
        component.setState({ responseText: utils.errorHandler(resp.status, response) });
    }
    else {
        component.setState({ responseText: utils.prettyJson(response) });
    }
};
var DownloadCallListener = function (component, resp, path) {
    if (resp.status !== 200) {
        component.setState({ responseText: utils.errorHandler(resp.status, utils.arrayBufToString(resp.response))
        });
    }
    else {
        var response = resp.getResponseHeader('dropbox-api-result');
        component.setState({ responseText: utils.prettyJson(response) });
        var toDownload = new Blob([resp.response], { type: 'application/octet-stream' });
        component.setState({
            downloadURL: URL.createObjectURL(toDownload),
            downloadFilename: path
        });
    }
};
/* Utility for determining the correct callback function given an endpoint's kind
   Since the download listener needs to know the filename (for saving the file), it's
   passed through this function.
 */
exports.chooseCallback = function (k, path) {
    switch (k) {
        case utils.EndpointKind.Download:
            return function (component, resp) {
                return DownloadCallListener(component, resp, path);
            };
        default: return JSONListener;
    }
};
var initRequest = function (endpt, token, data, listener, component) {
    var request = new XMLHttpRequest();
    request.onload = function (_) { return listener(component, request); };
    request.open('POST', endpt.getURL(), true);
    var headers = utils.getHeaders(endpt, token, data);
    for (var key in headers) {
        var value = headers[key];
        if (key == "Content-Type" && endpt.getEndpointKind() == utils.EndpointKind.RPCLike) {
            value = "text/plain; charset=dropbox-cors-hack";
        }
        request.setRequestHeader(key, value);
    }
    return request;
};
var beginRequest = function (component) {
    component.setState({ inProgress: true });
    component.setState({ hideResponse: true });
};
var endRequest = function (component) {
    component.setState({ inProgress: false });
    component.setState({ hideResponse: false });
};
/* This function actually makes the API call. There are three different paths, based on whether
   the endpoint is upload-like, download-like, or RPC-like.
   The file parameter will be null unless the user specified a file on an upload-like endpoint.
 */
var utf8Encode = function (data, request) {
    var blob = new Blob([data]);
    var reader = new FileReader();
    reader.onloadend = function () { return request.send(new Uint8Array(reader.result)); };
    reader.readAsArrayBuffer(blob);
};
exports.APIWrapper = function (data, endpt, token, listener, component, file) {
    beginRequest(component);
    var listener_wrapper = function (component, resp) {
        endRequest(component);
        listener(component, resp);
    };
    switch (endpt.getEndpointKind()) {
        case utils.EndpointKind.RPCLike:
            var request = initRequest(endpt, token, data, listener_wrapper, component);
            utf8Encode(data, request);
            break;
        case utils.EndpointKind.Upload:
            var request = initRequest(endpt, token, data, listener_wrapper, component);
            if (file !== null) {
                var reader = new FileReader();
                reader.onload = function () { return request.send(reader.result); };
                reader.readAsArrayBuffer(file);
            }
            else {
                request.send();
            }
            break;
        case utils.EndpointKind.Download:
            var request = initRequest(endpt, token, data, listener_wrapper, component);
            // Binary files shouldn't be accessed as strings
            request.responseType = 'arraybuffer';
            request.send();
            break;
    }
};

},{"./utils":6}],2:[function(require,module,exports){
(function (global){
/* The functions that handle the code view part of the interface: taking the input and
   representing it as an HTTP request or code to generate that request.
 */
var react = (typeof window !== "undefined" ? window['React'] : typeof global !== "undefined" ? global['React'] : null);
var utils = require('./utils');
var ce = react.createElement;
var d = react.DOM;
var syntaxHighlight = function (syntax, text) {
    return ce(utils.Highlight, { className: syntax }, text);
};
// Applies f to each element of the dict, and then appends the separator to all but the last result.
// Subsequent list elements are separated by newlines.
var joinWithNewlines = function (dc, f, sep) {
    if (sep === void 0) { sep = ','; }
    return utils.Dict._map(dc, function (k, v, i) {
        var maybeSep = (i === Object.keys(dc).length - 1) ?
            "\n" : sep + "\n";
        return d.span({ key: "" + i }, f(k, v), maybeSep);
    });
};
// the minor differences between JSON and Python's notation
var pythonStringify = function (val) {
    if (val === true) {
        return "True";
    }
    else if (val === false) {
        return "False";
    }
    else if (val === null || (val !== val)) {
        return "None";
    }
    else {
        return JSON.stringify(val);
    }
};
// Representation of a dict, or null if the passed-in dict is also null
var dictToPython = function (name, dc) { return d.span(null, name + ' = ', (dc === null) ?
    'None' : d.span(null, '{\n', joinWithNewlines(dc, function (k, v) { return '    "' + k + '": ' + pythonStringify(v); }), '}'), '\n\n'); };
// For curl calls, we need to escape single quotes, and sometimes also double quotes.
var shellEscape = function (val, inQuotes) {
    if (inQuotes === void 0) { inQuotes = false; }
    var toReturn = JSON.stringify(val).replace(/'/g, "'\\''");
    if (inQuotes)
        return toReturn.replace(/\\/g, '\\\\').replace(/"/g, '\\\"');
    else
        return toReturn;
};
// Generates the functions that make up the Python Requests code viewer
var RequestsCodeViewer = function () {
    var syntax = "python";
    // common among all three parts
    var preamble = function (endpt) { return d.span(null, 'import requests\n', 'import json\n\n', 'url = "' + endpt.getURL() + '"\n\n'); };
    var requestsTemplate = function (endpt, headers, dataReader, call) {
        return syntaxHighlight(syntax, d.span(null, preamble(endpt), dictToPython('headers', headers), dataReader, call));
    };
    var requestsRPCLike = function (endpt, token, paramVals) {
        return requestsTemplate(endpt, utils.getHeaders(endpt, token), dictToPython('data', paramVals), 'r = requests.post(url, headers=headers, data=json.dumps(data))');
    };
    var requestsUploadLike = function (endpt, token, paramVals, file) {
        return requestsTemplate(endpt, utils.getHeaders(endpt, token, JSON.stringify(paramVals)), 'data = open(' + JSON.stringify(file.name) + ', "rb").read()\n\n', 'r = requests.post(url, headers=headers, data=data)');
    };
    var requestsDownloadLike = function (endpt, token, paramVals) {
        return requestsTemplate(endpt, utils.getHeaders(endpt, token, JSON.stringify(paramVals)), '', 'r = requests.post(url, headers=headers)');
    };
    return {
        syntax: syntax,
        description: "Python request (requests library)",
        renderRPCLike: requestsRPCLike,
        renderUploadLike: requestsUploadLike,
        renderDownloadLike: requestsDownloadLike
    };
};
// Python's httplib library (which is also the urllib backend)
var HttplibCodeViewer = function () {
    var syntax = "python";
    var preamble = d.span(null, 'import sys\nimport json\n', 'if (3,0) <= sys.version_info < (4,0):\n', '    import http.client as httplib\n', 'elif (2,6) <= sys.version_info < (3,0):\n', '    import httplib\n\n');
    var httplibTemplate = function (endpt, headers, dataReader, dataArg) {
        return syntaxHighlight(syntax, d.span(null, preamble, dictToPython('headers', headers), dataReader, 'c = httplib.HTTPSConnection("' + endpt.getHostname() + '")\n', 'c.request("POST", "' + endpt.getPathName() + '", ' + dataArg + ', headers)\n', 'r = c.getresponse()'));
    };
    var httplibRPCLike = function (endpt, token, paramVals) {
        return httplibTemplate(endpt, utils.getHeaders(endpt, token), dictToPython('params', paramVals), 'json.dumps(params)');
    };
    var httplibUploadLike = function (endpt, token, paramVals, file) {
        return httplibTemplate(endpt, utils.getHeaders(endpt, token, JSON.stringify(paramVals)), 'data = open(' + JSON.stringify(file.name) + ', "rb")\n\n', 'data');
    };
    var httplibDownloadLike = function (endpt, token, paramVals) {
        return httplibTemplate(endpt, utils.getHeaders(endpt, token, JSON.stringify(paramVals)), '', '""');
    };
    return {
        syntax: syntax,
        description: "Python request (standard library)",
        renderRPCLike: httplibRPCLike,
        renderUploadLike: httplibUploadLike,
        renderDownloadLike: httplibDownloadLike
    };
};
var CurlCodeViewer = function () {
    var syntax = 'bash';
    var urlArea = function (endpt) { return 'curl -X POST ' + endpt.getURL() + ' \\\n'; };
    var makeHeaders = function (headers) { return d.span(null, utils.Dict._map(headers, function (k, v, i) {
        var sep = '\\\n';
        if (i == Object.keys(headers).length - 1)
            sep = '';
        return d.span({ key: "" + i }, "  --header '" + k + ': ' + v + "' " + sep);
    })); };
    // The general model of the curl call, populated with the arguments.
    var curlTemplate = function (endpt, headers, data) {
        return syntaxHighlight(syntax, d.span(null, urlArea(endpt), makeHeaders(headers), data));
    };
    var curlRPCLike = function (endpt, token, paramVals) {
        return curlTemplate(endpt, utils.getHeaders(endpt, token), "\\\n  --data '" + shellEscape(paramVals) + "'");
    };
    var curlUploadLike = function (endpt, token, paramVals, file) {
        var headers = utils.getHeaders(endpt, token, shellEscape(paramVals, false));
        return curlTemplate(endpt, headers, "\\\n  --data-binary @'" + file.name.replace(/'/g, "'\\''") + "'");
    };
    var curlDownloadLike = function (endpt, token, paramVals) {
        return curlTemplate(endpt, utils.getHeaders(endpt, token, shellEscape(paramVals, false)), '');
    };
    return {
        syntax: syntax,
        description: "curl request",
        renderRPCLike: curlRPCLike,
        renderUploadLike: curlUploadLike,
        renderDownloadLike: curlDownloadLike
    };
};
var HTTPCodeViewer = function () {
    var syntax = 'http';
    var httpTemplate = function (endpt, headers, body) {
        return syntaxHighlight(syntax, d.span(null, 'POST ' + endpt.getPathName() + "\n", 'Host: https://' + endpt.getHostname() + "\n", 'User-Agent: api-explorer-client\n', utils.Dict.map(headers, function (key, value) { return d.span({ key: key }, key + ": " + value + "\n"); }), body));
    };
    var httpRPCLike = function (endpt, token, paramVals) {
        var body = JSON.stringify(paramVals, null, 4);
        var headers = utils.getHeaders(endpt, token);
        // TODO: figure out how to determine the UTF-8 encoded length
        //headers['Content-Length'] = ...
        return httpTemplate(endpt, headers, "\n" + body);
    };
    var httpUploadLike = function (endpt, token, paramVals, file) {
        var headers = utils.getHeaders(endpt, token, JSON.stringify(paramVals));
        headers['Content-Length'] = file.size;
        return httpTemplate(endpt, headers, "\n--- (content of " + file.name + " goes here) ---");
    };
    var httpDownloadLike = function (endpt, token, paramVals) {
        var headers = utils.getHeaders(endpt, token, JSON.stringify(paramVals));
        return httpTemplate(endpt, headers, '');
    };
    return {
        syntax: syntax,
        description: 'HTTP request',
        renderRPCLike: httpRPCLike,
        renderUploadLike: httpUploadLike,
        renderDownloadLike: httpDownloadLike
    };
};
exports.formats = {
    'curl': CurlCodeViewer(),
    'requests': RequestsCodeViewer(),
    'httplib': HttplibCodeViewer(),
    'http': HTTPCodeViewer()
};
exports.getSelector = function (onChange) { return d.select({ onChange: onChange }, utils.Dict.map(exports.formats, function (key, cv) {
    return d.option({ key: key, value: key }, cv.description);
})); };
exports.render = function (cv, endpt, token, paramVals, file) {
    if (endpt.getEndpointKind() === utils.EndpointKind.RPCLike) {
        return cv.renderRPCLike(endpt, token, paramVals);
    }
    else if (file !== null) {
        return cv.renderUploadLike(endpt, token, paramVals, file);
    }
    else {
        return cv.renderDownloadLike(endpt, token, paramVals);
    }
};

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"./utils":6}],3:[function(require,module,exports){
/* The files contains helper functions to interact with cookie storage. This will be
   used a fallback when session/local storage is not allowed (safari private browsing
   mode etc.)
 */
exports.setItem = function (key, item) {
    document.cookie = encodeURIComponent(key) + "=" + encodeURIComponent(item);
};
exports.getItem = function (key) {
    var dict = exports.getAll();
    return dict[key];
};
exports.getAll = function () {
    var dict = {};
    var cookies = document.cookie.split('; ');
    cookies.forEach(function (value) {
        if (value.length > 0) {
            var items = value.split('=');
            dict[decodeURIComponent(items[0])] = decodeURIComponent(items[1]);
        }
    });
    return dict;
};

},{}],4:[function(require,module,exports){
// Automatically generated code; do not edit
var Utils = require('./utils');
var Endpoints;
(function (Endpoints) {
    var files_copy_endpt = new Utils.Endpoint("files", "copy", {}, new Utils.TextParam("from_path", false), new Utils.TextParam("to_path", false));
    var files_create_folder_endpt = new Utils.Endpoint("files", "create_folder", {}, new Utils.TextParam("path", false));
    var files_delete_endpt = new Utils.Endpoint("files", "delete", {}, new Utils.TextParam("path", false));
    var files_download_endpt = new Utils.Endpoint("files", "download", {
        host: "content",
        style: "download"
    }, new Utils.TextParam("path", false), new Utils.TextParam("rev", true));
    var files_get_metadata_endpt = new Utils.Endpoint("files", "get_metadata", {}, new Utils.TextParam("path", false), new Utils.BoolParam("include_media_info", true));
    var files_get_preview_endpt = new Utils.Endpoint("files", "get_preview", {
        host: "content",
        style: "download"
    }, new Utils.TextParam("path", false), new Utils.TextParam("rev", true));
    var files_get_thumbnail_endpt = new Utils.Endpoint("files", "get_thumbnail", {
        host: "content",
        style: "download"
    }, new Utils.TextParam("path", false), new Utils.UnionParam("format", true, [new Utils.VoidParam("jpeg"), new Utils.VoidParam("png")]), new Utils.UnionParam("size", true, [new Utils.VoidParam("w32h32"), new Utils.VoidParam("w64h64"), new Utils.VoidParam("w128h128"), new Utils.VoidParam("w640h480"), new Utils.VoidParam("w1024h768")]));
    var files_list_folder_endpt = new Utils.Endpoint("files", "list_folder", {}, new Utils.TextParam("path", false), new Utils.BoolParam("recursive", true), new Utils.BoolParam("include_media_info", true), new Utils.BoolParam("include_deleted", true));
    var files_list_folder_continue_endpt = new Utils.Endpoint("files", "list_folder/continue", {}, new Utils.TextParam("cursor", false));
    var files_list_folder_get_latest_cursor_endpt = new Utils.Endpoint("files", "list_folder/get_latest_cursor", {}, new Utils.TextParam("path", false), new Utils.BoolParam("recursive", true), new Utils.BoolParam("include_media_info", true), new Utils.BoolParam("include_deleted", true));
    var files_list_folder_longpoll_endpt = new Utils.Endpoint("files", "list_folder/longpoll", {
        host: "notify",
        auth: "noauth"
    }, new Utils.TextParam("cursor", false), new Utils.IntParam("timeout", true));
    var files_list_revisions_endpt = new Utils.Endpoint("files", "list_revisions", {}, new Utils.TextParam("path", false), new Utils.IntParam("limit", true));
    var files_move_endpt = new Utils.Endpoint("files", "move", {}, new Utils.TextParam("from_path", false), new Utils.TextParam("to_path", false));
    var files_permanently_delete_endpt = new Utils.Endpoint("files", "permanently_delete", {}, new Utils.TextParam("path", false));
    var files_restore_endpt = new Utils.Endpoint("files", "restore", {}, new Utils.TextParam("path", false), new Utils.TextParam("rev", false));
    var files_search_endpt = new Utils.Endpoint("files", "search", {}, new Utils.TextParam("path", false), new Utils.TextParam("query", false), new Utils.IntParam("start", true), new Utils.IntParam("max_results", true), new Utils.UnionParam("mode", true, [new Utils.VoidParam("filename"), new Utils.VoidParam("filename_and_content"), new Utils.VoidParam("deleted_filename")]));
    var files_upload_endpt = new Utils.Endpoint("files", "upload", {
        host: "content",
        style: "upload"
    }, new Utils.FileParam(), new Utils.TextParam("path", false), new Utils.UnionParam("mode", true, [new Utils.VoidParam("add"), new Utils.VoidParam("overwrite"), new Utils.TextParam("update", false)]), new Utils.BoolParam("autorename", true), new Utils.TextParam("client_modified", true), new Utils.BoolParam("mute", true));
    var files_upload_session_append_endpt = new Utils.Endpoint("files", "upload_session/append", {
        host: "content",
        style: "upload"
    }, new Utils.FileParam(), new Utils.TextParam("session_id", false), new Utils.IntParam("offset", false));
    var files_upload_session_finish_endpt = new Utils.Endpoint("files", "upload_session/finish", {
        host: "content",
        style: "upload"
    }, new Utils.FileParam(), new Utils.StructParam("cursor", false, [new Utils.TextParam("session_id", false), new Utils.IntParam("offset", false)]), new Utils.StructParam("commit", false, [new Utils.TextParam("path", false), new Utils.UnionParam("mode", true, [new Utils.VoidParam("add"), new Utils.VoidParam("overwrite"), new Utils.TextParam("update", false)]), new Utils.BoolParam("autorename", true), new Utils.TextParam("client_modified", true), new Utils.BoolParam("mute", true)]));
    var files_upload_session_start_endpt = new Utils.Endpoint("files", "upload_session/start", {
        host: "content",
        style: "upload"
    }, new Utils.FileParam());
    var sharing_add_folder_member_endpt = new Utils.Endpoint("sharing", "add_folder_member", {}, new Utils.TextParam("shared_folder_id", false), new Utils.ListParam("members", false, function (index) { return new Utils.StructParam(index, false, [new Utils.UnionParam("member", false, [new Utils.TextParam("dropbox_id", false), new Utils.TextParam("email", false), new Utils.VoidParam("other")]), new Utils.UnionParam("access_level", true, [new Utils.VoidParam("owner"), new Utils.VoidParam("editor"), new Utils.VoidParam("viewer"), new Utils.VoidParam("other")])]); }), new Utils.BoolParam("quiet", true), new Utils.TextParam("custom_message", true));
    var sharing_check_job_status_endpt = new Utils.Endpoint("sharing", "check_job_status", {}, new Utils.TextParam("async_job_id", false));
    var sharing_check_share_job_status_endpt = new Utils.Endpoint("sharing", "check_share_job_status", {}, new Utils.TextParam("async_job_id", false));
    var sharing_create_shared_link_endpt = new Utils.Endpoint("sharing", "create_shared_link", {}, new Utils.TextParam("path", false), new Utils.BoolParam("short_url", true), new Utils.UnionParam("pending_upload", true, [new Utils.VoidParam("file"), new Utils.VoidParam("folder")]));
    var sharing_create_shared_link_with_settings_endpt = new Utils.Endpoint("sharing", "create_shared_link_with_settings", {}, new Utils.TextParam("path", false), new Utils.StructParam("settings", true, [new Utils.UnionParam("requested_visibility", true, [new Utils.VoidParam("public"), new Utils.VoidParam("team_only"), new Utils.VoidParam("password")]), new Utils.TextParam("link_password", true), new Utils.TextParam("expires", true)]));
    var sharing_get_folder_metadata_endpt = new Utils.Endpoint("sharing", "get_folder_metadata", {}, new Utils.TextParam("shared_folder_id", false), new Utils.ListParam("actions", true, function (index) { return new Utils.UnionParam(index, false, [new Utils.VoidParam("change_options"), new Utils.VoidParam("edit_contents"), new Utils.VoidParam("invite_editor"), new Utils.VoidParam("invite_viewer"), new Utils.VoidParam("relinquish_membership"), new Utils.VoidParam("unmount"), new Utils.VoidParam("unshare"), new Utils.VoidParam("other")]); }));
    var sharing_get_shared_link_file_endpt = new Utils.Endpoint("sharing", "get_shared_link_file", {
        host: "content",
        style: "download"
    }, new Utils.TextParam("url", false), new Utils.TextParam("path", true), new Utils.TextParam("link_password", true));
    var sharing_get_shared_link_metadata_endpt = new Utils.Endpoint("sharing", "get_shared_link_metadata", {}, new Utils.TextParam("url", false), new Utils.TextParam("path", true), new Utils.TextParam("link_password", true));
    var sharing_get_shared_links_endpt = new Utils.Endpoint("sharing", "get_shared_links", {}, new Utils.TextParam("path", true));
    var sharing_list_folder_members_endpt = new Utils.Endpoint("sharing", "list_folder_members", {}, new Utils.TextParam("shared_folder_id", false), new Utils.ListParam("actions", true, function (index) { return new Utils.UnionParam(index, false, [new Utils.VoidParam("make_editor"), new Utils.VoidParam("make_owner"), new Utils.VoidParam("make_viewer"), new Utils.VoidParam("remove"), new Utils.VoidParam("other")]); }), new Utils.IntParam("limit", true));
    var sharing_list_folder_members_continue_endpt = new Utils.Endpoint("sharing", "list_folder_members/continue", {}, new Utils.TextParam("cursor", false));
    var sharing_list_folders_endpt = new Utils.Endpoint("sharing", "list_folders", {}, new Utils.IntParam("limit", true), new Utils.ListParam("actions", true, function (index) { return new Utils.UnionParam(index, false, [new Utils.VoidParam("change_options"), new Utils.VoidParam("edit_contents"), new Utils.VoidParam("invite_editor"), new Utils.VoidParam("invite_viewer"), new Utils.VoidParam("relinquish_membership"), new Utils.VoidParam("unmount"), new Utils.VoidParam("unshare"), new Utils.VoidParam("other")]); }));
    var sharing_list_folders_continue_endpt = new Utils.Endpoint("sharing", "list_folders/continue", {}, new Utils.TextParam("cursor", false));
    var sharing_list_mountable_folders_endpt = new Utils.Endpoint("sharing", "list_mountable_folders", {}, new Utils.IntParam("limit", true), new Utils.ListParam("actions", true, function (index) { return new Utils.UnionParam(index, false, [new Utils.VoidParam("change_options"), new Utils.VoidParam("edit_contents"), new Utils.VoidParam("invite_editor"), new Utils.VoidParam("invite_viewer"), new Utils.VoidParam("relinquish_membership"), new Utils.VoidParam("unmount"), new Utils.VoidParam("unshare"), new Utils.VoidParam("other")]); }));
    var sharing_list_mountable_folders_continue_endpt = new Utils.Endpoint("sharing", "list_mountable_folders/continue", {}, new Utils.TextParam("cursor", false));
    var sharing_list_shared_links_endpt = new Utils.Endpoint("sharing", "list_shared_links", {}, new Utils.TextParam("path", true), new Utils.TextParam("cursor", true), new Utils.BoolParam("direct_only", true));
    var sharing_modify_shared_link_settings_endpt = new Utils.Endpoint("sharing", "modify_shared_link_settings", {}, new Utils.TextParam("url", false), new Utils.StructParam("settings", false, [new Utils.UnionParam("requested_visibility", true, [new Utils.VoidParam("public"), new Utils.VoidParam("team_only"), new Utils.VoidParam("password")]), new Utils.TextParam("link_password", true), new Utils.TextParam("expires", true)]));
    var sharing_mount_folder_endpt = new Utils.Endpoint("sharing", "mount_folder", {}, new Utils.TextParam("shared_folder_id", false));
    var sharing_relinquish_folder_membership_endpt = new Utils.Endpoint("sharing", "relinquish_folder_membership", {}, new Utils.TextParam("shared_folder_id", false));
    var sharing_remove_folder_member_endpt = new Utils.Endpoint("sharing", "remove_folder_member", {}, new Utils.TextParam("shared_folder_id", false), new Utils.UnionParam("member", false, [new Utils.TextParam("dropbox_id", false), new Utils.TextParam("email", false), new Utils.VoidParam("other")]), new Utils.BoolParam("leave_a_copy", false));
    var sharing_revoke_shared_link_endpt = new Utils.Endpoint("sharing", "revoke_shared_link", {}, new Utils.TextParam("url", false));
    var sharing_share_folder_endpt = new Utils.Endpoint("sharing", "share_folder", {}, new Utils.TextParam("path", false), new Utils.UnionParam("member_policy", true, [new Utils.VoidParam("team"), new Utils.VoidParam("anyone"), new Utils.VoidParam("other")]), new Utils.UnionParam("acl_update_policy", true, [new Utils.VoidParam("owner"), new Utils.VoidParam("editors"), new Utils.VoidParam("other")]), new Utils.UnionParam("shared_link_policy", true, [new Utils.VoidParam("anyone"), new Utils.VoidParam("members"), new Utils.VoidParam("other")]), new Utils.BoolParam("force_async", true));
    var sharing_transfer_folder_endpt = new Utils.Endpoint("sharing", "transfer_folder", {}, new Utils.TextParam("shared_folder_id", false), new Utils.TextParam("to_dropbox_id", false));
    var sharing_unmount_folder_endpt = new Utils.Endpoint("sharing", "unmount_folder", {}, new Utils.TextParam("shared_folder_id", false));
    var sharing_unshare_folder_endpt = new Utils.Endpoint("sharing", "unshare_folder", {}, new Utils.TextParam("shared_folder_id", false), new Utils.BoolParam("leave_a_copy", true));
    var sharing_update_folder_member_endpt = new Utils.Endpoint("sharing", "update_folder_member", {}, new Utils.TextParam("shared_folder_id", false), new Utils.UnionParam("member", false, [new Utils.TextParam("dropbox_id", false), new Utils.TextParam("email", false), new Utils.VoidParam("other")]), new Utils.UnionParam("access_level", false, [new Utils.VoidParam("owner"), new Utils.VoidParam("editor"), new Utils.VoidParam("viewer"), new Utils.VoidParam("other")]));
    var sharing_update_folder_policy_endpt = new Utils.Endpoint("sharing", "update_folder_policy", {}, new Utils.TextParam("shared_folder_id", false), new Utils.UnionParam("member_policy", true, [new Utils.VoidParam("team"), new Utils.VoidParam("anyone"), new Utils.VoidParam("other")]), new Utils.UnionParam("acl_update_policy", true, [new Utils.VoidParam("owner"), new Utils.VoidParam("editors"), new Utils.VoidParam("other")]), new Utils.UnionParam("shared_link_policy", true, [new Utils.VoidParam("anyone"), new Utils.VoidParam("members"), new Utils.VoidParam("other")]));
    var team_devices_list_member_devices_endpt = new Utils.Endpoint("team", "devices/list_member_devices", {
        auth: "team"
    }, new Utils.TextParam("team_member_id", false), new Utils.BoolParam("include_web_sessions", true), new Utils.BoolParam("include_desktop_clients", true), new Utils.BoolParam("include_mobile_clients", true));
    var team_devices_list_team_devices_endpt = new Utils.Endpoint("team", "devices/list_team_devices", {
        auth: "team"
    }, new Utils.TextParam("cursor", true), new Utils.BoolParam("include_web_sessions", true), new Utils.BoolParam("include_desktop_clients", true), new Utils.BoolParam("include_mobile_clients", true));
    var team_devices_revoke_device_session_endpt = new Utils.Endpoint("team", "devices/revoke_device_session", {
        auth: "team"
    }, new Utils.StructParam("web_session", false, [new Utils.TextParam("session_id", false), new Utils.TextParam("team_member_id", false)]), new Utils.StructParam("desktop_client", false, [new Utils.TextParam("session_id", false), new Utils.TextParam("team_member_id", false), new Utils.BoolParam("delete_on_unlink", true)]), new Utils.StructParam("mobile_client", false, [new Utils.TextParam("session_id", false), new Utils.TextParam("team_member_id", false)]));
    var team_devices_revoke_device_session_batch_endpt = new Utils.Endpoint("team", "devices/revoke_device_session_batch", {
        auth: "team"
    }, new Utils.ListParam("revoke_devices", false, function (index) { return new Utils.UnionParam(index, false, [new Utils.StructParam("web_session", false, [new Utils.TextParam("session_id", false), new Utils.TextParam("team_member_id", false)]), new Utils.StructParam("desktop_client", false, [new Utils.TextParam("session_id", false), new Utils.TextParam("team_member_id", false), new Utils.BoolParam("delete_on_unlink", true)]), new Utils.StructParam("mobile_client", false, [new Utils.TextParam("session_id", false), new Utils.TextParam("team_member_id", false)])]); }));
    var team_get_info_endpt = new Utils.Endpoint("team", "get_info", {
        auth: "team"
    });
    var team_groups_create_endpt = new Utils.Endpoint("team", "groups/create", {
        auth: "team"
    }, new Utils.TextParam("group_name", false), new Utils.TextParam("group_external_id", true));
    var team_groups_delete_endpt = new Utils.Endpoint("team", "groups/delete", {
        auth: "team"
    }, new Utils.TextParam("group_id", false), new Utils.TextParam("group_external_id", false));
    var team_groups_get_info_endpt = new Utils.Endpoint("team", "groups/get_info", {
        auth: "team"
    }, new Utils.ListParam("group_ids", false, function (index) { return new Utils.TextParam(index, false); }), new Utils.ListParam("group_external_ids", false, function (index) { return new Utils.TextParam(index, false); }));
    var team_groups_job_status_get_endpt = new Utils.Endpoint("team", "groups/job_status/get", {
        auth: "team"
    }, new Utils.TextParam("async_job_id", false));
    var team_groups_list_endpt = new Utils.Endpoint("team", "groups/list", {
        auth: "team"
    }, new Utils.IntParam("limit", true));
    var team_groups_list_continue_endpt = new Utils.Endpoint("team", "groups/list/continue", {
        auth: "team"
    }, new Utils.TextParam("cursor", false));
    var team_groups_members_add_endpt = new Utils.Endpoint("team", "groups/members/add", {
        auth: "team"
    }, new Utils.UnionParam("group", false, [new Utils.TextParam("group_id", false), new Utils.TextParam("group_external_id", false)]), new Utils.ListParam("members", false, function (index) { return new Utils.StructParam(index, false, [new Utils.UnionParam("user", false, [new Utils.TextParam("team_member_id", false), new Utils.TextParam("external_id", false), new Utils.TextParam("email", false)]), new Utils.UnionParam("access_type", false, [new Utils.VoidParam("member"), new Utils.VoidParam("owner")])]); }));
    var team_groups_members_remove_endpt = new Utils.Endpoint("team", "groups/members/remove", {
        auth: "team"
    }, new Utils.UnionParam("group", false, [new Utils.TextParam("group_id", false), new Utils.TextParam("group_external_id", false)]), new Utils.ListParam("users", false, function (index) { return new Utils.UnionParam(index, false, [new Utils.TextParam("team_member_id", false), new Utils.TextParam("external_id", false), new Utils.TextParam("email", false)]); }));
    var team_groups_members_set_access_type_endpt = new Utils.Endpoint("team", "groups/members/set_access_type", {
        auth: "team"
    }, new Utils.UnionParam("group", false, [new Utils.TextParam("group_id", false), new Utils.TextParam("group_external_id", false)]), new Utils.UnionParam("user", false, [new Utils.TextParam("team_member_id", false), new Utils.TextParam("external_id", false), new Utils.TextParam("email", false)]), new Utils.UnionParam("access_type", false, [new Utils.VoidParam("member"), new Utils.VoidParam("owner")]));
    var team_groups_update_endpt = new Utils.Endpoint("team", "groups/update", {
        auth: "team"
    }, new Utils.UnionParam("group", false, [new Utils.TextParam("group_id", false), new Utils.TextParam("group_external_id", false)]), new Utils.TextParam("new_group_name", true), new Utils.TextParam("new_group_external_id", true));
    var team_linked_apps_list_member_linked_apps_endpt = new Utils.Endpoint("team", "linked_apps/list_member_linked_apps", {
        auth: "team"
    }, new Utils.TextParam("team_member_id", false));
    var team_linked_apps_list_team_linked_apps_endpt = new Utils.Endpoint("team", "linked_apps/list_team_linked_apps", {
        auth: "team"
    }, new Utils.TextParam("cursor", true));
    var team_linked_apps_revoke_linked_app_endpt = new Utils.Endpoint("team", "linked_apps/revoke_linked_app", {
        auth: "team"
    }, new Utils.TextParam("app_id", false), new Utils.TextParam("team_member_id", false), new Utils.BoolParam("keep_app_folder", true));
    var team_linked_apps_revoke_linked_app_batch_endpt = new Utils.Endpoint("team", "linked_apps/revoke_linked_app_batch", {
        auth: "team"
    }, new Utils.ListParam("revoke_linked_app", false, function (index) { return new Utils.StructParam(index, false, [new Utils.TextParam("app_id", false), new Utils.TextParam("team_member_id", false), new Utils.BoolParam("keep_app_folder", true)]); }));
    var team_members_add_endpt = new Utils.Endpoint("team", "members/add", {
        auth: "team"
    }, new Utils.ListParam("new_members", false, function (index) { return new Utils.StructParam(index, false, [new Utils.TextParam("member_email", false), new Utils.TextParam("member_given_name", false), new Utils.TextParam("member_surname", false), new Utils.TextParam("member_external_id", true), new Utils.BoolParam("send_welcome_email", true), new Utils.UnionParam("role", true, [new Utils.VoidParam("team_admin"), new Utils.VoidParam("user_management_admin"), new Utils.VoidParam("support_admin"), new Utils.VoidParam("member_only")])]); }), new Utils.BoolParam("force_async", true));
    var team_members_add_job_status_get_endpt = new Utils.Endpoint("team", "members/add/job_status/get", {
        auth: "team"
    }, new Utils.TextParam("async_job_id", false));
    var team_members_get_info_endpt = new Utils.Endpoint("team", "members/get_info", {
        auth: "team"
    }, new Utils.ListParam("members", false, function (index) { return new Utils.UnionParam(index, false, [new Utils.TextParam("team_member_id", false), new Utils.TextParam("external_id", false), new Utils.TextParam("email", false)]); }));
    var team_members_list_endpt = new Utils.Endpoint("team", "members/list", {
        auth: "team"
    }, new Utils.IntParam("limit", true));
    var team_members_list_continue_endpt = new Utils.Endpoint("team", "members/list/continue", {
        auth: "team"
    }, new Utils.TextParam("cursor", false));
    var team_members_remove_endpt = new Utils.Endpoint("team", "members/remove", {
        auth: "team"
    }, new Utils.UnionParam("user", false, [new Utils.TextParam("team_member_id", false), new Utils.TextParam("external_id", false), new Utils.TextParam("email", false)]), new Utils.BoolParam("wipe_data", true), new Utils.UnionParam("transfer_dest_id", true, [new Utils.TextParam("team_member_id", false), new Utils.TextParam("external_id", false), new Utils.TextParam("email", false)]), new Utils.UnionParam("transfer_admin_id", true, [new Utils.TextParam("team_member_id", false), new Utils.TextParam("external_id", false), new Utils.TextParam("email", false)]));
    var team_members_remove_job_status_get_endpt = new Utils.Endpoint("team", "members/remove/job_status/get", {
        auth: "team"
    }, new Utils.TextParam("async_job_id", false));
    var team_members_send_welcome_email_endpt = new Utils.Endpoint("team", "members/send_welcome_email", {
        auth: "team"
    }, new Utils.TextParam("team_member_id", false), new Utils.TextParam("external_id", false), new Utils.TextParam("email", false));
    var team_members_set_admin_permissions_endpt = new Utils.Endpoint("team", "members/set_admin_permissions", {
        auth: "team"
    }, new Utils.UnionParam("user", false, [new Utils.TextParam("team_member_id", false), new Utils.TextParam("external_id", false), new Utils.TextParam("email", false)]), new Utils.UnionParam("new_role", false, [new Utils.VoidParam("team_admin"), new Utils.VoidParam("user_management_admin"), new Utils.VoidParam("support_admin"), new Utils.VoidParam("member_only")]));
    var team_members_set_profile_endpt = new Utils.Endpoint("team", "members/set_profile", {
        auth: "team"
    }, new Utils.UnionParam("user", false, [new Utils.TextParam("team_member_id", false), new Utils.TextParam("external_id", false), new Utils.TextParam("email", false)]), new Utils.TextParam("new_email", true), new Utils.TextParam("new_external_id", true), new Utils.TextParam("new_given_name", true), new Utils.TextParam("new_surname", true));
    var team_members_suspend_endpt = new Utils.Endpoint("team", "members/suspend", {
        auth: "team"
    }, new Utils.UnionParam("user", false, [new Utils.TextParam("team_member_id", false), new Utils.TextParam("external_id", false), new Utils.TextParam("email", false)]), new Utils.BoolParam("wipe_data", true));
    var team_members_unsuspend_endpt = new Utils.Endpoint("team", "members/unsuspend", {
        auth: "team"
    }, new Utils.UnionParam("user", false, [new Utils.TextParam("team_member_id", false), new Utils.TextParam("external_id", false), new Utils.TextParam("email", false)]));
    var team_reports_get_activity_endpt = new Utils.Endpoint("team", "reports/get_activity", {
        auth: "team"
    }, new Utils.TextParam("start_date", true), new Utils.TextParam("end_date", true));
    var team_reports_get_devices_endpt = new Utils.Endpoint("team", "reports/get_devices", {
        auth: "team"
    }, new Utils.TextParam("start_date", true), new Utils.TextParam("end_date", true));
    var team_reports_get_membership_endpt = new Utils.Endpoint("team", "reports/get_membership", {
        auth: "team"
    }, new Utils.TextParam("start_date", true), new Utils.TextParam("end_date", true));
    var team_reports_get_storage_endpt = new Utils.Endpoint("team", "reports/get_storage", {
        auth: "team"
    }, new Utils.TextParam("start_date", true), new Utils.TextParam("end_date", true));
    var users_get_account_endpt = new Utils.Endpoint("users", "get_account", {}, new Utils.TextParam("account_id", false));
    var users_get_account_batch_endpt = new Utils.Endpoint("users", "get_account_batch", {}, new Utils.ListParam("account_ids", false, function (index) { return new Utils.TextParam(index, false); }));
    var users_get_current_account_endpt = new Utils.Endpoint("users", "get_current_account", {});
    var users_get_space_usage_endpt = new Utils.Endpoint("users", "get_space_usage", {});
    Endpoints.endpointList = [files_copy_endpt,
        files_create_folder_endpt,
        files_delete_endpt,
        files_download_endpt,
        files_get_metadata_endpt,
        files_get_preview_endpt,
        files_get_thumbnail_endpt,
        files_list_folder_endpt,
        files_list_folder_continue_endpt,
        files_list_folder_get_latest_cursor_endpt,
        files_list_folder_longpoll_endpt,
        files_list_revisions_endpt,
        files_move_endpt,
        files_permanently_delete_endpt,
        files_restore_endpt,
        files_search_endpt,
        files_upload_endpt,
        files_upload_session_append_endpt,
        files_upload_session_finish_endpt,
        files_upload_session_start_endpt,
        sharing_add_folder_member_endpt,
        sharing_check_job_status_endpt,
        sharing_check_share_job_status_endpt,
        sharing_create_shared_link_endpt,
        sharing_create_shared_link_with_settings_endpt,
        sharing_get_folder_metadata_endpt,
        sharing_get_shared_link_file_endpt,
        sharing_get_shared_link_metadata_endpt,
        sharing_get_shared_links_endpt,
        sharing_list_folder_members_endpt,
        sharing_list_folder_members_continue_endpt,
        sharing_list_folders_endpt,
        sharing_list_folders_continue_endpt,
        sharing_list_mountable_folders_endpt,
        sharing_list_mountable_folders_continue_endpt,
        sharing_list_shared_links_endpt,
        sharing_modify_shared_link_settings_endpt,
        sharing_mount_folder_endpt,
        sharing_relinquish_folder_membership_endpt,
        sharing_remove_folder_member_endpt,
        sharing_revoke_shared_link_endpt,
        sharing_share_folder_endpt,
        sharing_transfer_folder_endpt,
        sharing_unmount_folder_endpt,
        sharing_unshare_folder_endpt,
        sharing_update_folder_member_endpt,
        sharing_update_folder_policy_endpt,
        team_devices_list_member_devices_endpt,
        team_devices_list_team_devices_endpt,
        team_devices_revoke_device_session_endpt,
        team_devices_revoke_device_session_batch_endpt,
        team_get_info_endpt,
        team_groups_create_endpt,
        team_groups_delete_endpt,
        team_groups_get_info_endpt,
        team_groups_job_status_get_endpt,
        team_groups_list_endpt,
        team_groups_list_continue_endpt,
        team_groups_members_add_endpt,
        team_groups_members_remove_endpt,
        team_groups_members_set_access_type_endpt,
        team_groups_update_endpt,
        team_linked_apps_list_member_linked_apps_endpt,
        team_linked_apps_list_team_linked_apps_endpt,
        team_linked_apps_revoke_linked_app_endpt,
        team_linked_apps_revoke_linked_app_batch_endpt,
        team_members_add_endpt,
        team_members_add_job_status_get_endpt,
        team_members_get_info_endpt,
        team_members_list_endpt,
        team_members_list_continue_endpt,
        team_members_remove_endpt,
        team_members_remove_job_status_get_endpt,
        team_members_send_welcome_email_endpt,
        team_members_set_admin_permissions_endpt,
        team_members_set_profile_endpt,
        team_members_suspend_endpt,
        team_members_unsuspend_endpt,
        team_reports_get_activity_endpt,
        team_reports_get_devices_endpt,
        team_reports_get_membership_endpt,
        team_reports_get_storage_endpt,
        users_get_account_endpt,
        users_get_account_batch_endpt,
        users_get_current_account_endpt,
        users_get_space_usage_endpt];
})(Endpoints || (Endpoints = {}));
module.exports = Endpoints;

},{"./utils":6}],5:[function(require,module,exports){
(function (global){
/* The main file, which contains the definitions of the React components for the API Explorer, as
   well as a little bit of code that runs at startup.

   Each component is defined as an ES6 class extending the ReactComponent class. First, we declare
   the property types of the class, and then we declare the class itself.
 */
var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};
var react = (typeof window !== "undefined" ? window['React'] : typeof global !== "undefined" ? global['React'] : null);
var endpoints = require('./endpoints');
var utils = require('./utils');
var apicalls = require('./apicalls');
var codeview = require('./codeview');
var utils_1 = require("./utils");
var utils_2 = require("./utils");
var utils_3 = require("./utils");
var utils_4 = require("./utils");
var utils_5 = require("./utils");
var ce = react.createElement;
var d = react.DOM;
var developerPage = 'https://www.dropbox.com/developers';
var displayNone = { style: { display: 'none' } };
/* Element for text field in page table.
 */
var tableText = function (text) {
    return d.td({ className: 'label' }, d.div({ className: 'text' }, text));
};
/* Map between client id and associated permission type.
 */
var clientIdMap = {
    'vyjzkx2chlpsooc': 'Team Information',
    'pq2bj4ll002gohi': 'Team Auditing',
    'j3zzv20pgxds87u': 'Team Member File Access',
    'oq1ywlcgrto51qk': 'Team Member Management'
};
/* Get client id from local storage. If doesn't exist. Use default value instead.
 */
var getClientId = function () {
    var clientId = utils.getClientId();
    if (clientId != null) {
        return clientId;
    }
    return utils.getAuthType() == utils.AuthType.User
        ? 'cg750anjts67v15'
        : 'vyjzkx2chlpsooc';
};
/* The dropdown menu to select app permission type for business endpoints. For each
business endpoint. Only certain permission type would work and this component maps each
permission type to associated client id.
 */
var AppPermissionInputProps = (function () {
    function AppPermissionInputProps() {
    }
    return AppPermissionInputProps;
})();
var AppPermissionInput = (function (_super) {
    __extends(AppPermissionInput, _super);
    function AppPermissionInput(props) {
        _super.call(this, props);
    }
    AppPermissionInput.prototype.render = function () {
        var options = [];
        var clientId = getClientId();
        for (var id in clientIdMap) {
            var value = clientIdMap[id];
            var selected = id == clientId;
            options.push(d.option({ selected: selected }, value));
        }
        return d.tr(null, tableText('App Permission'), d.td(null, d.select({ style: { 'margin-top': '5px' }, onChange: this.props.handler }, options)));
    };
    return AppPermissionInput;
})(react.Component);
var TokenInput = (function (_super) {
    __extends(TokenInput, _super);
    function TokenInput(props) {
        _super.call(this, props);
        this.handleEdit = function (event) {
            return utils.putToken(event.target.value);
        };
        // This function handles the initial part of the OAuth2 token flow for the user.
        this.retrieveAuth = function () {
            var clientId = getClientId();
            var state = utils.getHashDict()['__ept__'] + '!' + utils.createCsrfToken();
            var params = {
                response_type: 'token',
                client_id: clientId,
                redirect_uri: utils.currentURL(),
                state: state
            };
            var urlWithParams = 'https://www.dropbox.com/1/oauth2/authorize?';
            for (var key in params) {
                urlWithParams += encodeURIComponent(key) + '=' + encodeURIComponent(params[key]) + '&';
            }
            window.location.assign(urlWithParams);
        };
    }
    TokenInput.prototype.render = function () {
        return d.tr(null, tableText('Access Token'), d.td(null, d.input({
            type: this.props.showToken ? 'text' : 'password',
            id: 'token-input',
            defaultValue: utils.getToken(),
            onChange: this.handleEdit,
            placeholder: 'If you don\'t have an access token, click the "Get Token" button to obtain one.'
        }), d.div({ className: 'align-right' }, d.button({ onClick: this.retrieveAuth }, 'Get Token'), d.button({ onClick: this.props.toggleShow }, this.props.showToken ? 'Hide Token' : 'Show Token'))));
    };
    return TokenInput;
})(react.Component);
/* Input component for single parameter.
   A value handler is responsible for value update and signal for specific parameter.
   Every time a field value gets updated, the update method of its corresponding value
   handler should be called.
 */
var ValueHandler = (function () {
    function ValueHandler() {
        // Signal react render.
        this.update = function () { return null; };
        // Update value for current parameter.
        this.updateValue = function (value) { return null; };
    }
    return ValueHandler;
})();
/*  Type of value handler which can contain child value handlers.
 */
var ParentValueHandler = (function (_super) {
    __extends(ParentValueHandler, _super);
    function ParentValueHandler() {
        var _this = this;
        _super.apply(this, arguments);
        // Create a child value handler based on parameter type.
        this.getChildHandler = function (param) {
            if (param instanceof utils_4.FileParam) {
                return new FileValueHandler(param, _this);
            }
            else if (param instanceof utils_3.UnionParam) {
                return new UnionValueHandler(param, _this);
            }
            else if (param instanceof utils_2.StructParam) {
                return new StructValueHandler(param, _this);
            }
            else if (param instanceof utils_5.ListParam) {
                return new ListValueHandler(param, _this);
            }
            else {
                return new ChildValueHandler(param, _this);
            }
        };
        this.getOrCreate = function (name, defaultValue) {
            var dict = _this.current();
            if (name in dict) {
                return dict[name];
            }
            else {
                dict[name] = defaultValue;
                return dict[name];
            }
        };
        this.hasChild = function (name) {
            var dict = _this.current();
            if (name in dict) {
                return true;
            }
            else {
                return false;
            }
        };
        this.value = function (key) {
            var dict = _this.current();
            if (key in dict) {
                return dict[key];
            }
            else {
                return null;
            }
        };
        this.updateChildValue = function (name, value) {
            var dict = _this.current();
            if (value == null) {
                delete dict[name];
            }
            else {
                dict[name] = value;
            }
        };
        this.current = function () { throw new Error('Not implemented.'); };
    }
    return ParentValueHandler;
})(ValueHandler);
/* Value handler for struct type.
 */
var StructValueHandler = (function (_super) {
    __extends(StructValueHandler, _super);
    function StructValueHandler(param, parent) {
        var _this = this;
        _super.call(this);
        this.current = function () { return _this.parent.getOrCreate(_this.param.name, {}); };
        this.update = function () { return _this.parent.update(); };
        this.param = param;
        this.parent = parent;
    }
    return StructValueHandler;
})(ParentValueHandler);
/* Value handler for union type.
 */
var UnionValueHandler = (function (_super) {
    __extends(UnionValueHandler, _super);
    function UnionValueHandler(param, parent) {
        var _this = this;
        _super.call(this, param, parent);
        this.getTag = function () {
            if (_this.parent.hasChild(_this.param.name)) {
                return _this.value('.tag');
            }
            else {
                return null;
            }
        };
        this.updateTag = function (tag) {
            _this.parent.updateChildValue(_this.param.name, null);
            if (tag != null) {
                _this.updateChildValue('.tag', tag);
            }
        };
        this.getTagHandler = function () {
            return new TagValueHandler(_this);
        };
    }
    return UnionValueHandler;
})(StructValueHandler);
/* Value handler for list type.
 */
var ListValueHandler = (function (_super) {
    __extends(ListValueHandler, _super);
    function ListValueHandler(param, parent) {
        var _this = this;
        _super.call(this);
        this.addItem = function () {
            var list = _this.current();
            var param = _this.param.createItem(0);
            list.push(param.defaultValue());
            _this.update();
        };
        this.reset = function () {
            _this.parent.updateChildValue(_this.param.name, _this.param.defaultValue());
            _this.update();
        };
        this.getOrCreate = function (name, defaultValue) {
            return _this.current()[+name];
        };
        this.hasChild = function (name) {
            return true;
        };
        this.value = function (key) {
            return _this.current()[+name];
        };
        this.updateChildValue = function (name, value) {
            _this.current()[+name] = value;
        };
        this.current = function () { return _this.parent.getOrCreate(_this.param.name, []); };
        this.update = function () { return _this.parent.update(); };
        this.param = param;
        this.parent = parent;
    }
    return ListValueHandler;
})(ParentValueHandler);
/* Value handler for primitive types.
 */
var ChildValueHandler = (function (_super) {
    __extends(ChildValueHandler, _super);
    function ChildValueHandler(param, parent) {
        var _this = this;
        _super.call(this);
        this.updateValue = function (value) {
            _this.parent.updateChildValue(_this.param.name, value);
        };
        this.update = function () { return _this.parent.update(); };
        this.param = param;
        this.parent = parent;
    }
    return ChildValueHandler;
})(ValueHandler);
/* Value handler for file parameter.
 */
var FileValueHandler = (function (_super) {
    __extends(FileValueHandler, _super);
    function FileValueHandler(param, parent) {
        var _this = this;
        _super.call(this, param, parent);
        // Update value of current parameter.
        this.updateValue = function (value) {
            _this.parent.updateFile(value);
        };
    }
    return FileValueHandler;
})(ChildValueHandler);
/* Value handler for union tag.
 */
var TagValueHandler = (function (_super) {
    __extends(TagValueHandler, _super);
    function TagValueHandler(parent) {
        var _this = this;
        _super.call(this, null, parent);
        this.updateValue = function (value) {
            _this.parent.updateTag(value);
        };
    }
    return TagValueHandler;
})(ChildValueHandler);
/* Value handler for root.
 */
var RootValueHandler = (function (_super) {
    __extends(RootValueHandler, _super);
    function RootValueHandler(paramVals, callback) {
        var _this = this;
        _super.call(this);
        this.current = function () { return _this.paramVals; };
        this.update = function () { return _this.callback(_this.paramVals, _this.file); };
        this.updateFile = function (value) { return _this.file = value; };
        this.paramVals = paramVals;
        this.file = null;
        this.callback = callback;
    }
    return RootValueHandler;
})(ParentValueHandler);
var ParamInput = (function (_super) {
    __extends(ParamInput, _super);
    function ParamInput(props) {
        _super.call(this, props);
    }
    ParamInput.prototype.render = function () {
        throw new Error('Not implemented.');
    };
    return ParamInput;
})(react.Component);
/* Input component for single parameter.
 */
var SingleParamInput = (function (_super) {
    __extends(SingleParamInput, _super);
    function SingleParamInput(props) {
        var _this = this;
        _super.call(this, props);
        // When the field is edited, its value is parsed and the state is updated.
        this.handleEdit = function (event) {
            var valueToReturn = null;
            // special case: the target isn't an HTMLInputElement
            if (_this.props.param.name === '__file__') {
                var fileTarget = event.target;
                if (fileTarget.files.length > 0)
                    valueToReturn = fileTarget.files[0];
            }
            else {
                var target = event.target;
                /* If valueToReturn is left as null, it signals an optional value that should be
                 deleted from the dict of param values.
                 */
                if (target.value !== '' || !_this.props.param.optional) {
                    valueToReturn = _this.props.param.getValue(target.value);
                }
            }
            _this.props.handler.updateValue(valueToReturn);
            _this.props.handler.update();
        };
    }
    SingleParamInput.prototype.render = function () {
        return this.props.param.asReact({ onChange: this.handleEdit }, this.props.key);
    };
    return SingleParamInput;
})(ParamInput);
var StructParamInput = (function (_super) {
    __extends(StructParamInput, _super);
    function StructParamInput(props) {
        var _this = this;
        _super.call(this, props);
        this.renderItems = function () {
            return _this.props.param.fields.map(function (p) {
                return ParamClassChooser.getParamInput(p, {
                    key: _this.props.key + '_' + _this.props.param.name + '_' + p.name,
                    handler: _this.props.handler.getChildHandler(p),
                    param: p
                });
            });
        };
    }
    StructParamInput.prototype.render = function () {
        return d.tr(null, this.props.param.getNameColumn(), d.td(null, d.table(null, d.tbody(null, this.renderItems()))));
    };
    return StructParamInput;
})(ParamInput);
var UnionParamInput = (function (_super) {
    __extends(UnionParamInput, _super);
    function UnionParamInput(props) {
        var _this = this;
        _super.call(this, props);
        this.getParam = function () {
            var tag = _this.props.handler.getTag();
            var fields = null;
            if (tag == null) {
                fields = [];
            }
            else {
                var param = _this.props.param.fields.filter(function (t) { return t.name == tag; })[0];
                if (param instanceof utils_2.StructParam) {
                    fields = param.fields;
                }
                else if (param instanceof utils_1.VoidParam) {
                    fields = [];
                }
                else {
                    fields = [param];
                }
            }
            return new utils_2.StructParam(_this.props.param.name, false, fields);
        };
    }
    UnionParamInput.prototype.render = function () {
        var selectParamProps = {
            key: this.props.key + '_selector',
            handler: this.props.handler.getTagHandler(),
            param: this.props.param.getSelectorParam(this.props.handler.getTag())
        };
        var param = this.getParam();
        if (param.fields.length == 0) {
            return ce(SingleParamInput, selectParamProps);
        }
        var structParam = new StructParamInput({
            key: this.props.key + '_' + param.name,
            handler: this.props.handler,
            param: param
        });
        return d.tr(null, this.props.param.getNameColumn(), d.td(null, d.table(null, d.tbody(null, [ce(SingleParamInput, selectParamProps)].concat(structParam.renderItems())))));
    };
    return UnionParamInput;
})(ParamInput);
var ListParamInput = (function (_super) {
    __extends(ListParamInput, _super);
    function ListParamInput(props) {
        var _this = this;
        _super.call(this, props);
        this.addItem = function () {
            _this.props.handler.addItem();
            _this.setState({ 'count': _this.state.count + 1 });
        };
        this.reset = function () {
            _this.props.handler.reset();
            _this.setState({ 'count': 0 });
        };
        this.renderItems = function () {
            var ret = [];
            for (var i = 0; i < _this.state.count; i++) {
                var param = _this.props.param.createItem(i);
                var item = ParamClassChooser.getParamInput(param, {
                    key: _this.props.key + '_' + _this.props.param.name + '_' + i.toString(),
                    handler: _this.props.handler.getChildHandler(param),
                    param: param
                });
                ret.push(item);
            }
            ret.push(d.tr({ className: 'list-param-actions' }, d.td(null, d.button({ onClick: _this.addItem }, 'Add'), d.button({ onClick: _this.reset }, 'Clear'))));
            return ret;
        };
        this.state = { 'count': 0 };
    }
    ListParamInput.prototype.render = function () {
        return d.tr(null, this.props.param.getNameColumn(), d.td(null, d.table(null, d.tbody(null, this.renderItems()))));
    };
    return ListParamInput;
})(ParamInput);
// Picks the correct React class for a parameter, depending on whether it's a struct.
var ParamClassChooser = (function () {
    function ParamClassChooser() {
    }
    ParamClassChooser.getParamInput = function (param, props) {
        if (param instanceof utils.UnionParam) {
            return ce(UnionParamInput, props);
        }
        else if (param instanceof utils.StructParam) {
            return ce(StructParamInput, props);
        }
        else if (param instanceof utils.ListParam) {
            return ce(ListParamInput, props);
        }
        else {
            return ce(SingleParamInput, props);
        }
    };
    return ParamClassChooser;
})();
var CodeArea = (function (_super) {
    __extends(CodeArea, _super);
    function CodeArea(props) {
        var _this = this;
        _super.call(this, props);
        this.changeFormat = function (event) {
            var newFormat = event.target.value;
            _this.setState({ formatter: codeview.formats[newFormat] });
        };
        this.state = { formatter: codeview.formats['curl'] };
    }
    CodeArea.prototype.render = function () {
        return d.span({ id: 'code-area' }, d.p(null, 'View request as ', codeview.getSelector(this.changeFormat)), d.span(null, codeview.render(this.state.formatter, this.props.ept, this.props.token, this.props.paramVals, this.props.__file__)));
    };
    return CodeArea;
})(react.Component);
var RequestArea = (function (_super) {
    __extends(RequestArea, _super);
    function RequestArea(props) {
        var _this = this;
        _super.call(this, props);
        this.updateParamValues = function (paramVals, file) {
            _this.setState({ paramVals: paramVals, __file__: file });
        };
        /* Called when a new endpoint is chosen or the user updates the token. If a new endpoint is
           chosen, we should initialize its parameter values; if a new token is chosen, any error
           message about the token no longer applies.
         */
        this.componentWillReceiveProps = function (newProps) {
            if (newProps.currEpt !== _this.props.currEpt) {
                _this.setState({ paramVals: utils.initialValues(newProps.currEpt) });
            }
            _this.setState({ __file__: null, errMsg: null });
        };
        /* Submits a call to the API. This function handles the display logic (e.g. whether or not to
           display an error message for a missing token), and the APICaller prop actually sends the
           request.
         */
        this.submit = function () {
            var token = utils.getToken();
            if (token == null || token === '') {
                _this.setState({
                    errMsg: 'Error: missing token. Please enter a token above or click the "Get Token" button.'
                });
            }
            else {
                _this.setState({ errMsg: null });
                var responseFn = apicalls.chooseCallback(_this.props.currEpt.getEndpointKind(), utils.getDownloadName(_this.props.currEpt, _this.state.paramVals));
                _this.props.APICaller(JSON.stringify(_this.state.paramVals), _this.props.currEpt, token, responseFn, _this.state.__file__);
            }
        };
        // Toggles whether the token is hidden, or visible on the screen.
        this.showOrHide = function () { return _this.setState({ showToken: !_this.state.showToken }); };
        // Toggles whether code block is visiable.
        this.showOrHideCode = function () { return _this.setState({ showCode: !_this.state.showCode }); };
        // Update client id when app permission change.
        this.updateClientId = function (e) {
            var value = (e.target).value;
            for (var id in clientIdMap) {
                if (clientIdMap[id] == value) {
                    utils.putClientId(id);
                    return;
                }
            }
        };
        this.state = {
            paramVals: utils.initialValues(this.props.currEpt),
            __file__: null,
            errMsg: null,
            showToken: true,
            showCode: false
        };
    }
    RequestArea.prototype.render = function () {
        var _this = this;
        var errMsg = [];
        if (this.state.errMsg != null) {
            errMsg = [d.span({ style: { color: 'red' } }, this.state.errMsg)];
        }
        var name = this.props.currEpt.name.replace('/', '-');
        var documentation = developerPage + "/documentation/http/documentation#" + this.props.currEpt.ns + "-" + name;
        var handler = new RootValueHandler(this.state.paramVals, this.updateParamValues);
        return d.span({ id: 'request-area' }, d.table({ className: 'page-table' }, d.tbody(null, utils.getAuthType() == utils.AuthType.Team
            ? ce(AppPermissionInput, { handler: this.updateClientId })
            : null, ce(TokenInput, {
            toggleShow: this.showOrHide,
            showToken: this.state.showToken
        }), d.tr(null, tableText('Request'), d.td(null, d.div({ className: 'align-right' }, d.a({ href: documentation }, 'Documentation')), d.table({ id: 'parameter-list' }, d.tbody(null, this.props.currEpt.params.map(function (param) {
            return ParamClassChooser.getParamInput(param, {
                key: _this.props.currEpt.name + param.name,
                handler: handler.getChildHandler(param),
                param: param
            });
        }))), d.div(null, d.button({ onClick: this.showOrHideCode }, this.state.showCode ? 'Hide Code' : 'Show Code'), d.button({ onClick: this.submit, disabled: this.props.inProgress }, 'Submit Call'), d.img({
            src: 'https://www.dropbox.com/static/images/icons/ajax-loading-small.gif',
            hidden: !this.props.inProgress,
            style: { position: 'relative', top: '2px', left: '10px' }
        }), errMsg))), d.tr(this.state.showCode ? null : displayNone, tableText('Code'), d.td(null, d.div({ id: 'request-container' }, ce(CodeArea, {
            ept: this.props.currEpt,
            paramVals: this.state.paramVals,
            __file__: this.state.__file__,
            token: this.state.showToken ? utils.getToken() : '<access-token>'
        })))))));
    };
    return RequestArea;
})(react.Component);
var EndpointChoice = (function (_super) {
    __extends(EndpointChoice, _super);
    function EndpointChoice(props) {
        var _this = this;
        _super.call(this, props);
        this.onClick = function () { return _this.props.handleClick(_this.props.ept); };
    }
    EndpointChoice.prototype.render = function () {
        return (this.props.isSelected) ?
            d.li(null, d.b(null, this.props.ept.name), d.br(null)) :
            d.li(null, d.a({ onClick: this.onClick }, this.props.ept.name), d.br(null));
    };
    return EndpointChoice;
})(react.Component);
var EndpointSelector = (function (_super) {
    __extends(EndpointSelector, _super);
    function EndpointSelector(props) {
        _super.call(this, props);
        this.filter = function (ept) {
            if (ept.params.length > 0 && ept.params.indexOf(null) >= 0) {
                // Skip not implemented endpoints.
                return true;
            }
            var eptAuthType = ept.getAuthType() == utils.AuthType.Team
                ? utils.AuthType.Team
                : utils.AuthType.User;
            if (eptAuthType != utils.getAuthType()) {
                // Skip endpoints with different auth type.
                return true;
            }
            return false;
        };
    }
    // Renders the logo and the list of endpoints
    EndpointSelector.prototype.render = function () {
        var _this = this;
        var groups = {};
        var namespaces = [];
        endpoints.endpointList.forEach(function (ept) {
            if (_this.filter(ept)) {
                return;
            }
            if (groups[ept.ns] == undefined) {
                groups[ept.ns] = [ept];
                namespaces.push(ept.ns);
            }
            else {
                groups[ept.ns].push(ept);
            }
        });
        return d.div({ 'id': 'sidebar' }, d.p({ style: { marginLeft: '35px', marginTop: '12px' } }, d.a({ onClick: function () { return window.location.href = developerPage; } }, d.img({
            src: 'https://cf.dropboxstatic.com/static/images/icons/blue_dropbox_glyph-vflJ8-C5d.png',
            width: 36,
            className: 'home-icon'
        }))), d.div({ id: 'endpoint-list' }, namespaces.sort().map(function (ns) {
            return d.div(null, d.li(null, ns), groups[ns].map(function (ept) {
                return ce(EndpointChoice, {
                    key: ept.name,
                    ept: ept,
                    handleClick: _this.props.eptChanged,
                    isSelected: _this.props.currEpt == ept
                });
            }));
        })));
    };
    return EndpointSelector;
})(react.Component);
var ResponseArea = (function (_super) {
    __extends(ResponseArea, _super);
    function ResponseArea(props) {
        _super.call(this, props);
    }
    ResponseArea.prototype.render = function () {
        return d.span({ id: 'response-area' }, d.table({ className: 'page-table' }, d.tbody(this.props.hide ? displayNone : null, d.tr(null, tableText('Response'), d.td(null, d.div({ id: 'response-container' }, ce(utils.Highlight, { className: 'json' }, this.props.responseText)), d.div(null, this.props.downloadButton))))));
    };
    return ResponseArea;
})(react.Component);
var APIExplorer = (function (_super) {
    __extends(APIExplorer, _super);
    function APIExplorer(props) {
        var _this = this;
        _super.call(this, props);
        this.componentWillReceiveProps = function (newProps) { return _this.setState({
            ept: newProps.initEpt,
            downloadURL: '',
            responseText: ''
        }); };
        this.APICaller = function (paramsData, endpt, token, responseFn, file) {
            _this.setState({ inProgress: true });
            var responseFn_wrapper = function (component, resp) {
                _this.setState({ inProgress: false });
                responseFn(component, resp);
            };
            apicalls.APIWrapper(paramsData, endpt, token, responseFn_wrapper, _this, file);
        };
        this.state = {
            ept: this.props.initEpt,
            downloadURL: '',
            responseText: '',
            inProgress: false
        };
    }
    APIExplorer.prototype.render = function () {
        // This button pops up only on download
        var downloadButton = (this.state.downloadURL !== '') ?
            d.a({
                href: this.state.downloadURL,
                download: this.state.downloadFilename
            }, d.button(null, 'Download ' + this.state.downloadFilename)) :
            null;
        var props = {
            currEpt: this.state.ept,
            header: d.span(null, 'Dropbox API Explorer • ' + this.state.ept.name),
            messages: [
                ce(RequestArea, {
                    currEpt: this.state.ept,
                    APICaller: this.APICaller,
                    inProgress: this.state.inProgress
                }),
                ce(ResponseArea, {
                    hide: this.state.inProgress || this.state.responseText == '',
                    responseText: this.state.responseText,
                    downloadButton: downloadButton
                })
            ]
        };
        return ce(MainPage, props);
    };
    return APIExplorer;
})(react.Component);
var MainPage = (function (_super) {
    __extends(MainPage, _super);
    function MainPage(props) {
        _super.call(this, props);
        this.getAuthSwitch = function () {
            if (utils.getAuthType() == utils.AuthType.User) {
                return d.a({ id: 'auth-switch', href: utils.currentURL() + 'team/' }, 'Switch to Business endpoints');
            }
            else {
                return d.a({ id: 'auth-switch', href: '../' }, 'Switch to User endpoints');
            }
        };
    }
    MainPage.prototype.render = function () {
        return d.span(null, ce(EndpointSelector, {
            eptChanged: function (endpt) { return window.location.hash = '#' + endpt.getFullName(); },
            currEpt: this.props.currEpt
        }), d.h1({ id: 'header' }, this.props.header, this.getAuthSwitch()), d.div({ id: 'page-content' }, this.props.messages));
    };
    return MainPage;
})(react.Component);
var TextPage = (function (_super) {
    __extends(TextPage, _super);
    function TextPage(props) {
        _super.call(this, props);
    }
    TextPage.prototype.render = function () {
        return ce(MainPage, {
            currEpt: new utils.Endpoint('', '', null),
            header: d.span(null, 'Dropbox API Explorer'),
            messages: [this.props.message]
        });
    };
    return TextPage;
})(react.Component);
// Introductory page, which people see when they first open the webpage
var introPage = ce(TextPage, {
    message: d.span(null, d.p(null, 'Welcome to the Dropbox API Explorer!'), d.p(null, 'This API Explorer is a tool to help you learn about the ', d.a({ href: developerPage }, 'Dropbox API v2'), " and test your own examples. For each endpoint, you'll be able to submit an API call ", 'with your own parameters and see the code for that call, as well as the API response.'), d.p(null, 'Click on an endpoint on your left to get started, or check out ', d.a({ href: developerPage + '/documentation' }, 'the documentation'), ' for more information on the API.')) });
/* The endpoint name (supplied via the URL's hash) doesn't correspond to any actual endpoint. Right
   now, this can only happen if the user edits the URL hash.
   React sanitizes its inputs, so displaying the hash below is safe.
 */
var endpointNotFound = ce(TextPage, {
    message: d.span(null, d.p(null, 'Welcome to the Dropbox API Explorer!'), d.p(null, "Unfortunately, there doesn't seem to be an endpoint called ", d.b(null, window.location.hash.substr(1)), '. Try clicking on an endpoint on the left instead.'), d.p(null, 'If you think you received this message in error, please get in contact with us.')) });
/* Error when the state parameter of the hash isn't what was expected, which could be due to an
   XSRF attack.
 */
var stateError = ce(TextPage, {
    message: d.span(null, d.p(null, ''), d.p(null, 'Unfortunately, there was a problem retrieving your OAuth2 token; please try again. ', 'If this error persists, you may be using an insecure network.'), d.p(null, 'If you think you received this message in error, please get in contact with us.')) });
/* The hash of the URL determines which page to render; no hash renders the intro page, and
   'auth_error!' (the ! chosen so it's less likely to have a name clash) renders the stateError
   page when the state parameter isn't what was expected.
 */
var renderGivenHash = function (hash) {
    if (hash === '' || hash === undefined) {
        react.render(introPage, document.body);
    }
    else if (hash === 'xkcd') {
        window.location.href = 'https://xkcd.com/1481/';
    }
    else if (hash === 'auth_error!') {
        react.render(stateError, document.body);
    }
    else {
        var currEpt = utils.getEndpoint(endpoints.endpointList, decodeURIComponent(hash));
        if (currEpt === null) {
            react.render(endpointNotFound, document.body);
        }
        else {
            react.render(ce(APIExplorer, { initEpt: currEpt }), document.body);
        }
    }
};
var checkCsrf = function (state) {
    if (state === null)
        return null;
    var div = state.indexOf('!');
    if (div < 0)
        return null;
    var csrfToken = state.substring(div + 1);
    if (!utils.checkCsrfToken(csrfToken))
        return null;
    return state.substring(0, div); // The part before the CSRF token.
};
/* Things that need to be initialized at the start.
    1. Set up the listener for hash changes.
    2. Process the initial hash. This only occurs when the user goes through token flow, which
       redirects the page back to the API Explorer website, but with a hash that contains the
       token and some extra state (to check against XSRF attacks).
 */
var main = function () {
    window.onhashchange = function (e) {
        //first one works everywhere but IE, second one works everywhere but Firefox 40
        renderGivenHash(e.newURL ? e.newURL.split('#')[1] : window.location.hash.slice(1));
    };
    var hashes = utils.getHashDict();
    if ('state' in hashes) {
        var state = checkCsrf(hashes['state']);
        if (state === null) {
            window.location.hash = '#auth_error!';
        }
        else {
            utils.putToken(hashes['access_token']);
            window.location.href = utils.currentURL() + '#' + state;
        }
    }
    else if ('__ept__' in hashes) {
        renderGivenHash(hashes['__ept__']);
    }
    else {
        react.render(introPage, document.body);
    }
};
main();

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"./apicalls":1,"./codeview":2,"./endpoints":4,"./utils":6}],6:[function(require,module,exports){
(function (global){
/* This file contains utility functions needed by the other modules. These can be grouped into the
   following broad categories:

   - Definitions of the Endpoint and Parameter classes, and the various Parameter subclasses
     corresponding to the different kinds of parameters
   - Utilities for token flow: getting and setting state, and retrieving or storing the token in
     session storage
   - Utilities for processing user input in order to submit it
   - A React class for highlighting the code view and response parts of the document
   - Functions to generate the headers for a given API call
 */
var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};
var react = (typeof window !== "undefined" ? window['React'] : typeof global !== "undefined" ? global['React'] : null);
var hljs = (typeof window !== "undefined" ? window['hljs'] : typeof global !== "undefined" ? global['hljs'] : null);
var cookie = require('./cookie');
var ce = react.createElement;
var d = react.DOM;
// This class mostly exists to help Typescript type-check my programs.
var Dict = (function () {
    function Dict() {
    }
    /* Two methods for mapping through dictionaries, customized to the API Explorer's use case.
       - _map takes function from a key, a value, and an index to a React element, and
       - map is the same, but without an index.
       These are used, for example, to convert a dict of HTTP headers into its representation
       in code view.
     */
    Dict._map = function (dc, f) {
        return Object.keys(dc).map(function (key, i) { return f(key, dc[key], i); });
    };
    Dict.map = function (dc, f) {
        return Object.keys(dc).map(function (key) { return f(key, dc[key]); });
    };
    return Dict;
})();
exports.Dict = Dict;
var List = (function () {
    function List() {
        var _this = this;
        this.push = function (value) { return _this.push(value); };
    }
    return List;
})();
exports.List = List;
/* Helper class which deal with local storage. If session storage is allowed, items
   will be written to session storage. If session storage is disabled (e.g. safari
   private browsing mode), cookie storage will be used as fallback.
 */
var LocalStorage = (function () {
    function LocalStorage() {
    }
    LocalStorage._is_session_storage_allowed = function () {
        var test = 'test';
        try {
            localStorage.setItem(test, test);
            localStorage.removeItem(test);
            return true;
        }
        catch (e) {
            return false;
        }
    };
    LocalStorage.setItem = function (key, data) {
        if (LocalStorage._is_session_storage_allowed()) {
            sessionStorage.setItem(key, data);
        }
        else {
            cookie.setItem(key, data);
        }
    };
    LocalStorage.getItem = function (key) {
        if (LocalStorage._is_session_storage_allowed()) {
            return sessionStorage.getItem(key);
        }
        else {
            return cookie.getItem(key);
        }
    };
    return LocalStorage;
})();
exports.LocalStorage = LocalStorage;
/* There are three kinds of endpoints, and a lot of the program logic depends on what kind of
   endpoint is currently being shown.
    - An RPC-like endpoint involves no uploading or downloading of data; it sends a request
      with JSON data in the body, and receives a JSON response. Example: get_metadata
    - An upload-like endpoint sends file data in the body and the arguments in a header, but
      receives a JSON response. Example: upload
    - A download-style endpoint sends a request with JSON data, but receives the file in the
      response body. Example: get_thumbnail
 */
(function (EndpointKind) {
    EndpointKind[EndpointKind["RPCLike"] = 0] = "RPCLike";
    EndpointKind[EndpointKind["Upload"] = 1] = "Upload";
    EndpointKind[EndpointKind["Download"] = 2] = "Download";
})(exports.EndpointKind || (exports.EndpointKind = {}));
var EndpointKind = exports.EndpointKind;
;
(function (AuthType) {
    AuthType[AuthType["None"] = 0] = "None";
    AuthType[AuthType["User"] = 1] = "User";
    AuthType[AuthType["Team"] = 2] = "Team";
})(exports.AuthType || (exports.AuthType = {}));
var AuthType = exports.AuthType;
;
/* A class with all the information about an endpoint: its name and namespace; its kind
   (as listed above), and its list of parameters. The endpoints are all initialized in
   endpoints.ts, which is code-generated.
 */
var Endpoint = (function () {
    function Endpoint(ns, name, attrs) {
        var _this = this;
        var params = [];
        for (var _i = 3; _i < arguments.length; _i++) {
            params[_i - 3] = arguments[_i];
        }
        this.getHostname = function () {
            switch (_this.attrs["host"]) {
                case "content":
                    return "content.dropboxapi.com";
                case "notify":
                    return "notify.dropboxapi.com";
                default:
                    return "api.dropboxapi.com";
            }
        };
        this.getAuthType = function () {
            if (_this.attrs["host"] == "notify") {
                return AuthType.None;
            }
            else if (_this.attrs["auth"] == "team") {
                return AuthType.Team;
            }
            else {
                return AuthType.User;
            }
        };
        this.getEndpointKind = function () {
            switch (_this.attrs["style"]) {
                case "upload":
                    return EndpointKind.Upload;
                case "download":
                    return EndpointKind.Download;
                default:
                    return EndpointKind.RPCLike;
            }
        };
        this.getPathName = function () { return '/2/' + _this.ns + '/' + _this.name; };
        this.getFullName = function () { return _this.ns + '_' + _this.name; };
        this.getURL = function () { return 'https://' + _this.getHostname() + _this.getPathName(); };
        this.ns = ns;
        this.name = name;
        this.attrs = attrs;
        this.params = params;
    }
    return Endpoint;
})();
exports.Endpoint = Endpoint;
/* A parameter to an API endpoint. This class is abstract, as different kinds of parameters
   (e.g. text, integer) will implement it differently.
 */
var Parameter = (function () {
    function Parameter(name, optional) {
        var _this = this;
        this.getNameColumn = function () {
            if (!isNaN(+_this.name)) {
                // Don't show name column for list parameter item.
                return null;
            }
            var displayName = (_this.name !== '__file__') ? _this.name : 'File to upload';
            if (_this.optional)
                displayName += ' (optional)';
            var nameArgs = _this.optional ? { 'style': { 'color': '#999' } } : {};
            return d.td(nameArgs, displayName);
        };
        /* Each subclass will implement these abstract methods differently.
            - getValue should parse the value in the string and return the (typed) value for that
              parameter. For example, integer parameters will use parseInt here.
            - defaultValue should return the initial value if the endpoint is required (e.g.
              0 for integers, '' for strings).
            - innerReact determines how to render the input field for a parameter.
         */
        this.getValue = function (s) { return s; };
        this.defaultValue = function () { return ""; };
        this.innerReact = function (props) { return null; };
        this.name = name;
        this.optional = optional;
    }
    /* Renders the parameter's input field, using another method which depends on the
       parameter's subclass.
     */
    Parameter.prototype.asReact = function (props, key) {
        return d.tr({ key: key }, this.getNameColumn(), d.td(null, this.innerReact(props)));
    };
    return Parameter;
})();
exports.Parameter = Parameter;
exports.parameterInput = function (props) {
    props['className'] = 'parameter-input';
    return d.input(props);
};
// A parameter whose value is a string.
var TextParam = (function (_super) {
    __extends(TextParam, _super);
    function TextParam(name, optional) {
        _super.call(this, name, optional);
        this.innerReact = function (props) { return exports.parameterInput(props); };
    }
    return TextParam;
})(Parameter);
exports.TextParam = TextParam;
// A parameter whose value is an integer.
var IntParam = (function (_super) {
    __extends(IntParam, _super);
    function IntParam(name, optional) {
        var _this = this;
        _super.call(this, name, optional);
        this.innerReact = function (props) { return exports.parameterInput(props); };
        this.getValue = function (s) { return (s === '') ? _this.defaultValue() : parseInt(s, 10); };
        this.defaultValue = function () { return 0; };
    }
    return IntParam;
})(Parameter);
exports.IntParam = IntParam;
/* A parameter whose value is a float.
   This isn't currently used in our API, but could be in the future.
 */
var FloatParam = (function (_super) {
    __extends(FloatParam, _super);
    function FloatParam(name, optional) {
        var _this = this;
        _super.call(this, name, optional);
        this.innerReact = function (props) { return exports.parameterInput(props); };
        this.getValue = function (s) { return (s === '') ? _this.defaultValue() : parseFloat(s); };
        this.defaultValue = function () { return 0; };
    }
    return FloatParam;
})(Parameter);
exports.FloatParam = FloatParam;
/* A parameter whose type is void.
 */
var VoidParam = (function (_super) {
    __extends(VoidParam, _super);
    function VoidParam(name) {
        _super.call(this, name, true);
        this.defaultValue = function () { return null; };
        this.getValue = function (s) { return null; };
    }
    return VoidParam;
})(Parameter);
exports.VoidParam = VoidParam;
var SelectorParam = (function (_super) {
    __extends(SelectorParam, _super);
    function SelectorParam(name, optional, choices, selected) {
        var _this = this;
        if (selected === void 0) { selected = null; }
        _super.call(this, name, optional);
        this.defaultValue = function () { return _this.choices[0]; };
        this.getValue = function (s) { return s; };
        this.innerReact = function (props) {
            props['value'] = _this.selected;
            return d.select(props, _this.choices.map(function (choice) { return d.option({
                key: choice,
                value: choice
            }, choice); }));
        };
        this.choices = choices;
        if (this.optional) {
            this.choices.unshift('');
        }
        this.selected = selected != null ? selected : this.defaultValue();
    }
    return SelectorParam;
})(Parameter);
exports.SelectorParam = SelectorParam;
// Booleans are selectors for true or false.
var BoolParam = (function (_super) {
    __extends(BoolParam, _super);
    function BoolParam(name, optional) {
        _super.call(this, name, optional, ['false', 'true']);
        this.getValue = function (s) { return s === 'true'; };
    }
    return BoolParam;
})(SelectorParam);
exports.BoolParam = BoolParam;
/* Upload-style endpoints accept data to upload. This is implemented as a special parameter
   to each endpoint, with the special name __file__. However, it's not technically an
   argument to its endpoint: the file is handled separately from the other parameters, since
   its contents are treated as data.
   Note that, since the name is fixed, only one file parameter can be used per endpoint right
   now.
 */
var FileParam = (function (_super) {
    __extends(FileParam, _super);
    function FileParam() {
        _super.call(this, '__file__', false);
        this.innerReact = function (props) {
            props['type'] = 'file';
            return exports.parameterInput(props);
        };
    }
    return FileParam;
})(Parameter);
exports.FileParam = FileParam;
/* A few parameters are structs whose fields are other parameters. The user will just see the
   fields as if they were top-level parameters, but the backend collects them into one
   dictionary.
   TODO: can structs be optional? If so, how do I hint this to the user?
 */
var StructParam = (function (_super) {
    __extends(StructParam, _super);
    function StructParam(name, optional, fields) {
        var _this = this;
        _super.call(this, name, optional);
        this.populateFields = function (dict) {
            _this.fields.forEach(function (field) {
                if (!field.optional) {
                    dict[field.name] = field.defaultValue();
                }
            });
        };
        this.defaultValue = function () {
            var toReturn = {};
            _this.populateFields(toReturn);
            return toReturn;
        };
        this.fields = fields;
    }
    return StructParam;
})(Parameter);
exports.StructParam = StructParam;
// Union are selectors with multiple fields.
var UnionParam = (function (_super) {
    __extends(UnionParam, _super);
    function UnionParam(name, optional, fields) {
        var _this = this;
        _super.call(this, name, optional, fields);
        this.getSelectorParam = function (selected) {
            if (selected === void 0) { selected = null; }
            var choices = [];
            _this.fields.forEach(function (p) { return choices.push(p.name); });
            return new SelectorParam(_this.name, _this.optional, choices, selected);
        };
        this.defaultValue = function () {
            if (_this.optional) {
                return null;
            }
            var param = _this.fields[0];
            var toReturn = { '.tag': param.name };
            if (param instanceof StructParam) {
                param.populateFields(toReturn);
            }
            else if (param instanceof VoidParam) {
            }
            else {
                toReturn[param.name] = param.defaultValue();
            }
            return toReturn;
        };
    }
    return UnionParam;
})(StructParam);
exports.UnionParam = UnionParam;
var ListParam = (function (_super) {
    __extends(ListParam, _super);
    function ListParam(name, optional, creator) {
        var _this = this;
        _super.call(this, name, optional);
        this.createItem = function (index) { return _this.creator(index.toString()); };
        this.defaultValue = function () {
            return _this.optional ? null : [];
        };
        this.creator = creator;
    }
    return ListParam;
})(Parameter);
exports.ListParam = ListParam;
// Utilities for token flow
var csrfTokenStorageName = 'Dropbox_API_state';
var tokenStorageName = 'Dropbox_API_explorer_token';
var clientIdStorageName = 'Dropbox_API_explorer_client_id';
exports.getAuthType = function () {
    return window.location.href.indexOf('/team') > 0
        ? AuthType.Team
        : AuthType.User;
};
exports.createCsrfToken = function () {
    var randomBytes = new Uint8Array(18); // multiple of 3 avoids base-64 padding
    // If available, use the cryptographically secure generator, otherwise use Math.random.
    var crypto = window.crypto || window.msCrypto;
    if (crypto && crypto.getRandomValues && false) {
        crypto.getRandomValues(randomBytes);
    }
    else {
        for (var i = 0; i < randomBytes.length; i++) {
            randomBytes[i] = Math.floor(Math.random() * 256);
        }
    }
    var token = btoa(String.fromCharCode.apply(null, randomBytes)); // base64-encode
    LocalStorage.setItem(csrfTokenStorageName, token);
    return token;
};
exports.checkCsrfToken = function (givenCsrfToken) {
    var expectedCsrfToken = LocalStorage.getItem(csrfTokenStorageName);
    if (expectedCsrfToken === null)
        return false;
    return givenCsrfToken === expectedCsrfToken; // TODO: timing attack in string comparison?
};
// A utility to read the URL's hash and parse it into a dict.
exports.getHashDict = function () {
    var toReturn = {};
    var index = window.location.href.indexOf('#');
    if (index === -1)
        return toReturn;
    var hash = window.location.href.substr(index + 1);
    var hashes = hash.split('#');
    hashes.forEach(function (s) {
        if (s.indexOf('&') == -1)
            toReturn['__ept__'] = decodeURIComponent(s);
        else {
            s.split('&').forEach(function (pair) {
                var splitPair = pair.split('=');
                toReturn[decodeURIComponent(splitPair[0])] = decodeURIComponent(splitPair[1]);
            });
        }
    });
    return toReturn;
};
// Reading and writing the token, which is preserved in LocalStorage.
exports.putToken = function (token) {
    LocalStorage.setItem(tokenStorageName + '_' + exports.getAuthType(), token);
};
exports.getToken = function () {
    return LocalStorage.getItem(tokenStorageName + '_' + exports.getAuthType());
};
// Reading and writing the client id, which is preserved in LocalStorage.
exports.putClientId = function (clientId) {
    LocalStorage.setItem(clientIdStorageName + '_' + exports.getAuthType(), clientId);
};
exports.getClientId = function () {
    return LocalStorage.getItem(clientIdStorageName + '_' + exports.getAuthType());
};
// Some utilities that help with processing user input
// Returns an endpoint given its name, or null if there was none
exports.getEndpoint = function (epts, name) {
    for (var i = 0; i < epts.length; i++) {
        if (epts[i].getFullName() === name)
            return epts[i];
    }
    return null; // signals an error
};
/* Returns the intial values for the parameters of an endpoint. Specifically, the non-optional
   parameters' initial values are put into the paramVals dictionary. This ensures that the
   required parameters are never missing when the 'submit' button is pressed.
   If there are no parameters (except possibly a file), then the dict should be null rather
   than an empty dict.
 */
exports.initialValues = function (ept) {
    if (ept.params.length == 0)
        return null;
    if (ept.params.length == 1 && ept.params[0].name === '__file__')
        return null;
    var toReturn = {};
    ept.params.forEach(function (param) {
        if (!param.optional && param.name !== '__file__') {
            toReturn[param.name] = param.defaultValue();
        }
    });
    return toReturn;
};
/* For a download endpoint, this function calculates the filename that the data should be saved
   as. First, it takes the basename of the 'path' argument, and then changes the extension for
   the get_thumbnail endpoint (which is a special case).
   This function assumes every download-style endpoint has a parameter named 'path.'
 */
exports.getDownloadName = function (ept, paramVals) {
    if (paramVals !== null && 'path' in paramVals) {
        var toReturn = paramVals['path'].split('/').pop();
        if (ept.name === 'get_thumbnail') {
            var format = ('format' in paramVals) ? paramVals['format'] : 'jpeg';
            toReturn = toReturn.substr(0, toReturn.lastIndexOf('.')) + '.' + format;
        }
        return toReturn;
    }
    else
        return ''; // not a download-style endpoint anyways
};
// Returns the current URL without any fragment
exports.currentURL = function () { return window.location.href.split('#', 1)[0]; };
exports.arrayBufToString = function (buf) {
    return String.fromCharCode.apply(null, new Uint8Array(buf));
};
var isJson = function (s) {
    try {
        JSON.parse(s);
        return true;
    }
    catch (_) {
        return false;
    }
};
// Applies pretty-printing to JSON data serialized as a string.
exports.prettyJson = function (s) { return JSON.stringify(JSON.parse(s), null, 2); };
// common message for error handling
exports.errorHandler = function (stat, response) {
    if (isJson(response))
        return d.code(null, exports.prettyJson(response));
    else
        return d.span(null, d.h4(null, "Error: " + stat), d.code(null, response));
};
// Since HTTP headers cannot contain arbitrary Unicode characters, we must replace them.
exports.escapeUnicode = function (s) { return s.replace(/[\u007f-\uffff]/g, function (c) { return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4); }); };
var Highlight = (function (_super) {
    __extends(Highlight, _super);
    function Highlight(props) {
        var _this = this;
        _super.call(this, props);
        this.defaultProps = { className: "" };
        this.componentDidMount = function () { return _this.highlightCode(); };
        this.componentDidUpdate = function () { return _this.highlightCode(); };
        this.highlightCode = function () { return [].forEach.call(react.findDOMNode(_this).querySelectorAll('pre code'), function (node) { return hljs.highlightBlock(node); }); };
    }
    Highlight.prototype.render = function () {
        return d.pre({ className: this.props.className }, d.code({ className: this.props.className }, this.props.children));
    };
    return Highlight;
})(react.Component);
exports.Highlight = Highlight;
// Utility functions for getting the headers for an API call
// The headers for an RPC-like endpoint HTTP request
exports.RPCLikeHeaders = function (token, includeAuth) {
    var toReturn = {};
    if (includeAuth) {
        toReturn['Authorization'] = "Bearer " + token;
    }
    toReturn["Content-Type"] = "application/json";
    return toReturn;
};
// args may need to be modified by the client, so they're passed in as a string
exports.uploadLikeHeaders = function (token, args) {
    return {
        Authorization: "Bearer " + token,
        "Content-Type": "application/octet-stream",
        "Dropbox-API-Arg": exports.escapeUnicode(args)
    };
};
exports.downloadLikeHeaders = function (token, args) {
    return {
        Authorization: "Bearer " + token,
        "Dropbox-API-Arg": exports.escapeUnicode(args)
    };
};
exports.getHeaders = function (ept, token, args) {
    if (args === void 0) { args = null; }
    switch (ept.getEndpointKind()) {
        case EndpointKind.RPCLike: return exports.RPCLikeHeaders(token, ept.getAuthType() != AuthType.None);
        case EndpointKind.Upload: return exports.uploadLikeHeaders(token, args);
        case EndpointKind.Download: return exports.downloadLikeHeaders(token, args);
    }
};

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"./cookie":3}],7:[function(require,module,exports){

},{}]},{},[5,7])


//# sourceMappingURL=all.js.map