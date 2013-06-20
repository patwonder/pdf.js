"use strict"

/**
*
*  Base64 encode / decode
*  http://www.webtoolkit.info/
*
**/
 
var Base64 = {
	// private property
	_keyStr : "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=",
 
	// public method for encoding
	encode : function (input) {
    input = Base64._utf8_encode(input);
    return this._base64_encode(input);
  },
  
  // public method for decoding
	decode : function (input) {
    input = this._base64_decode(input);
    return Base64._utf8_decode(input);
  },

  _base64_encode: function(input) {
    if (typeof(window.btoa) == "function") {
      this._base64_encode = function(input) btoa(input);
    } else {
      this._base64_encode = function(input) {
        var output = "";
        var chr1, chr2, chr3, enc1, enc2, enc3, enc4;
        var i = 0;

        while (i < input.length) {
     
          chr1 = input.charCodeAt(i++);
          chr2 = input.charCodeAt(i++);
          chr3 = input.charCodeAt(i++);
     
          enc1 = chr1 >> 2;
          enc2 = ((chr1 & 3) << 4) | (chr2 >> 4);
          enc3 = ((chr2 & 15) << 2) | (chr3 >> 6);
          enc4 = chr3 & 63;
     
          if (isNaN(chr2)) {
            enc3 = enc4 = 64;
          } else if (isNaN(chr3)) {
            enc4 = 64;
          }
     
          output = output +
          this._keyStr.charAt(enc1) + this._keyStr.charAt(enc2) +
          this._keyStr.charAt(enc3) + this._keyStr.charAt(enc4);
        }
     
        return output;
      }
    }
    return this._base64_encode(input);
	},

  _base64_decode: function(input) {
    if (typeof(window.atob) == "function") {
      this._base64_decode = function(input) atob(input);
    } else {
      this._base64_decode = function(input) {
        var output = "";
        var chr1, chr2, chr3;
        var enc1, enc2, enc3, enc4;
        var i = 0;
        
        input = input.replace(/[^A-Za-z0-9\+\/\=]/g, "");
     
        while (i < input.length) {
          enc1 = this._keyStr.indexOf(input.charAt(i++));
          enc2 = this._keyStr.indexOf(input.charAt(i++));
          enc3 = this._keyStr.indexOf(input.charAt(i++));
          enc4 = this._keyStr.indexOf(input.charAt(i++));
     
          chr1 = (enc1 << 2) | (enc2 >> 4);
          chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
          chr3 = ((enc3 & 3) << 6) | enc4;
     
          output = output + String.fromCharCode(chr1);
     
          if (enc3 != 64) {
            output = output + String.fromCharCode(chr2);
          }
          if (enc4 != 64) {
            output = output + String.fromCharCode(chr3);
          }
        }
     
        return output;
      }
    }
    return this._base64_decode(input);
	},
 
	// private method for UTF-8 encoding
	_utf8_encode : function (string) {
		string = string.replace(/\r\n/g,"\n");
		var utftext = "";
 
		for (var n = 0; n < string.length; n++) {
			var c = string.charCodeAt(n);
 
			if (c < 128) {
				utftext += String.fromCharCode(c);
			}
			else if((c > 127) && (c < 2048)) {
				utftext += String.fromCharCode((c >> 6) | 192);
				utftext += String.fromCharCode((c & 63) | 128);
			}
			else {
				utftext += String.fromCharCode((c >> 12) | 224);
				utftext += String.fromCharCode(((c >> 6) & 63) | 128);
				utftext += String.fromCharCode((c & 63) | 128);
			}
		}
 
		return utftext;
	},
 
	// private method for UTF-8 decoding
	_utf8_decode : function (utftext) {
		var string = "";
		var i = 0;
		var c = c1 = c2 = 0;
 
		while ( i < utftext.length ) {
			c = utftext.charCodeAt(i);
 
			if (c < 128) {
				string += String.fromCharCode(c);
				i++;
			}
			else if((c > 191) && (c < 224)) {
				c2 = utftext.charCodeAt(i+1);
				string += String.fromCharCode(((c & 31) << 6) | (c2 & 63));
				i += 2;
			}
			else {
				c2 = utftext.charCodeAt(i+1);
				c3 = utftext.charCodeAt(i+2);
				string += String.fromCharCode(((c & 15) << 12) | ((c2 & 63) << 6) | (c3 & 63));
				i += 3;
			}
		}
    
		return string;
	}
};

var Utils = {
  // Return the position of the topleft corner of the client area relative to 
  // the entire document
  getClientPosition: function(element) {
    if (!element) return { left: 0, top: 0 };
    var bb = element.getBoundingClientRect();
    var left = bb.left + window.pageXOffset;
    var top = bb.top + window.pageYOffset;
    return { left: left, top: top };
  },
  
  // Return the position of pos relative to element2's client area
  // where pos is a position relative to element1's client area
  // Use null for the element to specify position relative to the document
  translatePosition: function(pos, element1, element2) {
    var pos1 = Utils.getClientPosition(element1);
    var pos2 = Utils.getClientPosition(element2);
    return {
      left: pos.left + pos1.left - pos2.left,
      top: pos.top + pos1.top - pos2.top
    };
  },
  
  // Getting the html representation of a plain text
  getHtmlEntities: function(str) {
    var pre = document.createElement("pre");
    pre.textContent = str;
    return pre.innerHTML;
  }
};
