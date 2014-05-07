(function(factory) {
    'use strict';

    if (typeof define === 'function' && define.amd) {
        define(['mimeparser', 'stringencoding'], factory);
    } else if (typeof exports === 'object') {
        module.exports = factory(require('mimeparser'), require('stringencoding'));
    }
})(function(MimeParser, stringencoding) {
    'use strict';

    var TextDecoder = stringencoding.TextDecoder;

    var parser = {};

    // parse the body parts and handle the results for the individual mime nodes
    parser.parse = function(bodyParts, cb) {
        var parsedCounter = 0;
        bodyParts.forEach(function(bodyPart) {
            var parser = new MimeParser();
            parser.onend = function() {
                walkMimeTree(parser.node, bodyPart);
                delete bodyPart.raw;

                // we're done with a body part, are we done?
                parsedCounter++;
                if (parsedCounter < bodyParts.length) {
                    return;
                }

                cb(bodyParts);
            };
            parser.end(bodyPart.raw);
        });
    };

    var mimeTreeMatchers = [matchEncrypted, matchSigned, matchText, matchHtml, matchAttachment];

    function walkMimeTree(mimeNode, bodyPart) {
        var i = mimeTreeMatchers.length;
        while (i--) {
            if (mimeTreeMatchers[i](mimeNode, bodyPart)) {
                return;
            }
        }

        if (mimeNode._childNodes) {
            mimeNode._childNodes.forEach(function(childNode) {
                walkMimeTree(childNode, bodyPart);
            });
        }
    }

    /**
     * Matches encrypted PGP/MIME nodes
     *
     * multipart/encrypted
     * |
     * |-- application/pgp-encrypted
     * |-- application/octet-stream <-- ciphertext
     */
    function matchEncrypted(node, bodyPart) {
        var isEncrypted = /^multipart\/encrypted/i.test(node.contentType.value) && node._childNodes && node._childNodes[1];
        if (!isEncrypted) {
            return false;
        }

        bodyPart.content = new TextDecoder('utf-8').decode(node._childNodes[1].content);
        return true;
    }

    /**
     * Matches signed PGP/MIME nodes
     *
     * multipart/signed
     * |
     * |-- *** (signed mime sub-tree)
     * |-- application/pgp-signature
     */
    function matchSigned(node, bodyPart) {
        var isSigned = /^multipart\/signed/i.test(node.contentType.value) && node._childNodes && node._childNodes[0] && node._childNodes[1] && /^application\/pgp-signature/i.test(node._childNodes[1].contentType.value);

        if (!isSigned) {
            return false;
        }

        // remember the correct node to do the parsing of the nested nodes
        var part;
        if (bodyPart.type === 'signed') {
            // this mime node is the signed node we gave to the mimeparser
            part = bodyPart;
        } else {
            // this parsed mime node is part of an encrypted node
            part = {
                type: 'signed',
                content: []
            };
            bodyPart.content.push(part);
        }

        part.signed = node._childNodes[0].raw;
        part.signature = new TextDecoder('utf-8').decode(node._childNodes[1].content);

        // walk the mime tree to find the nested nodes
        walkMimeTree(node._childNodes[0], part);

        return true;
    }

    /**
     * Matches non-attachment text/plain nodes
     */
    function matchText(node, bodyPart) {
        var disposition = node.headers['content-disposition'],
            isText = (/^text\/plain/i.test(node.contentType.value) && (!disposition || (disposition && disposition[0].value !== 'attachment')));

        if (!isText) {
            return false;
        }

        var content = new TextDecoder('utf-8').decode(node.content).replace(/([\r]?\n)*$/g, '');
        if (bodyPart.type === 'text') {
            // this mime node is the text node we gave to the mimeparser
            bodyPart.content = content;
        } else {
            // this mime node is part of a signed or encrypted node
            bodyPart.content.push({
                type: 'text',
                content: content
            });
        }

        return true;
    }

    /**
     * Matches non-attachment text/html nodes
     */
    function matchHtml(node, bodyPart) {
        var disposition = node.headers['content-disposition'],
            isHtml = (/^text\/html/i.test(node.contentType.value) && (!disposition || (disposition && disposition[0].value !== 'attachment')));

        if (!isHtml) {
            return false;
        }

        var content = new TextDecoder('utf-8').decode(node.content).replace(/([\r]?\n)*$/g, '');
        if (bodyPart.type === 'html') {
            // this mime node is the html node we gave to the mimeparser
            bodyPart.content = content;
        } else {
            // this mime node is part of a signed or encrypted node
            bodyPart.content.push({
                type: 'html',
                content: content
            });
        }

        return true;
    }

    /**
     * Matches non-attachment text/html nodes
     */
    function matchAttachment(node, bodyPart) {
        var disposition = node.headers['content-disposition'],
            contentType = node.contentType.value,
            isTextAttachment = /^text\//i.test(contentType) && !! disposition && disposition[0].value === 'attachment',
            isOtherAttachment = !/^text\//i.test(contentType) && !/^multipart\//i.test(contentType);

        if (!isTextAttachment && !isOtherAttachment) {
            return false;
        }

        if (bodyPart.type === 'attachment') {
            // this mime node is the attachment node we gave to the mimeparser
            bodyPart.content = node.content;
        } else {
            // this mime node is part of a signed or encrypted node
            bodyPart.content.push({
                type: 'attachment',
                content: node.content,
                id: node.headers['content-id'] ? node.headers['content-id'][0].value : undefined
            });
        }

        return true;
    }

    return parser;
});