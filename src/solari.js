/*
 * Copyright (c) Greg Furga
 *
 * This software is provided 'as-is', without any express or implied
 * warranty. In no event will the authors be held liable for any damages
 * arising from the use of this software.
 *
 * Permission is granted to anyone to use this software for any purpose,
 * including commercial applications, and to alter it and redistribute it
 * freely, subject to the following restrictions:
 *
 *    1. The origin of this software must not be misrepresented; you must not
 *    claim that you wrote the original software. If you use this software
 *    in a product, an acknowledgment in the product documentation would be
 *    appreciated but is not required.
 *
 *    2. Altered source versions must be plainly marked as such, and must not
 *    be misrepresented as being the original software.
 *
 *    3. This notice may not be removed or altered from any source
 *    distribution.
 */

define([
    "lib/gl-matrix.js",
], function() {
    "use strict";

    var SolariBoard = function (gl, options) {
        /*
         * The Board renders with a single draw call, with both the vertices
         * and texture coords stored in buffer objects.
         *
         * The first iteration of the solariboard build new geometry everytime
         * the message was updated. This shader version only updates a list of
         * floats defining the char to render, therefore only needing a single
         * buffer update.
         */
        this.texture = options.texture;
        this.chars = options.chars.split('');
        this.rows = options.rows;
        this.cols = options.cols;
        this.speed = options.speed || 0.005;

        // A single variable passed into the animating shaders defining the
        // animation timeframe. The char buffer allows a unique offset for
        // each character.
        this.timing = 0.0;

        // We need this to fillup the charBuffer
        this.verticesPerChar = 16;

        this.vertexBuffer = gl.createBuffer();
        this.indexBuffer = gl.createBuffer();
        this.charBufferObject = gl.createBuffer();

        var indexBuffer = []
          , vertexBuffer = [];


        // Setup an interlaced buffer with vertices and tex coords
        this._buildBuffers(indexBuffer, vertexBuffer);
        this.numIndices = indexBuffer.length;

        gl.bindBuffer(gl.ARRAY_BUFFER, this.charBufferObject);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(this.charBuffer), gl.DYNAMIC_DRAW);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertexBuffer), gl.STATIC_DRAW);

        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indexBuffer), gl.STATIC_DRAW);
    };

    SolariBoard.prototype.bindShaderAttribs = function(gl, character, position, texture) {
        /*
         * Point the shader attributes to the appropriate buffers.
         */
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.charBufferObject);
        gl.enableVertexAttribArray(character);
        gl.vertexAttribPointer(character, 2, gl.FLOAT, false, 8, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
        gl.enableVertexAttribArray(position);
        gl.vertexAttribPointer(position, 3, gl.FLOAT, false, 20, 0);

        if (texture) {
            // the velocity rendering shader doesn't use the texture coord
            gl.enableVertexAttribArray(texture);
            gl.vertexAttribPointer(texture, 2, gl.FLOAT, false, 20, 12);
        }
    };

    SolariBoard.prototype._buildBuffers = function(indexBuffer, vertexBuffer, charBuffer) {
        var extend = function(a1, a2) { a1.push.apply(a1, a2); }
          , addFaceIndices = function(arr, a, b, c, d) { arr.push(c, d, a, c, a, b); }
          , i, j
          , index
          , x, y, z
          , charWidth = 1.0, charHeight = 1.0 // !charHeight is assumed to be 1.0 in the shaders!
          , offsetX = 0.1, spacing = 0.1;

        this.charBuffer = new Array(2 * this.verticesPerChar * this.cols * this.rows);
        this.charBufferDirty = false;
        // Fill the char buffer with the "space" character
        for (i=0; i<this.charBuffer.length; i++) {
            this.charBuffer[i] = this.chars.length - 1;
        }

        // Add 4 vertices, texture coords and indices for each "flap"
        function setupCharHalf(x, y, u, v, i, animated, flipped) {

            // Z coordinate is used as a marker for the animated vertices
            // This is by far the biggest hack in this solari implementation.
            // The shader animates the rotation of the flaps, but the same
            // code runs for each vertex and we only want to animate 2 verts
            // for some of the flaps. So we need a way to "mark" them. We use
            // z for this.
            animated = (animated) ? 1.0 : 0.0;
            z = 0;
            var topUV = (flipped) ? -0.5 : 0.5;

            extend(vertexBuffer, [x, y, z]);
            extend(vertexBuffer, [u, v]);

            extend(vertexBuffer, [x+charWidth, y, z]);
            extend(vertexBuffer, [u+1, v]);

            extend(vertexBuffer, [x+charWidth, y+charHeight, z+animated]);
            extend(vertexBuffer, [u+1, v+topUV]);

            extend(vertexBuffer, [x, y+charHeight, z+animated]);
            extend(vertexBuffer, [u,   v+topUV]);

            if (flipped) {
                addFaceIndices(indexBuffer, i+3, i+2, i+1, i+0);
            } else {
                addFaceIndices(indexBuffer, i+0, i+1, i+2, i+3);
            }
        };

        offsetX = (-this.cols/2) * (charWidth + spacing);
        y = ( this.rows/2 - 0.5) * (2*charHeight + spacing);
        index = 0;
        for (j=0; j < this.rows; j++) {
            x = offsetX;

            for (i=0; i < this.cols; i++) {
                setupCharHalf(x, y-1, 0,   0, index);           // botom half of current character
                setupCharHalf(x, y,   1, 0.5, index+4);         // top half of next character

                setupCharHalf(x, y,   0, 0.5, index+8, true);   // animated flap with current character
                setupCharHalf(x, y,   1, 0.5, index+12, true, true);   // animated flap with the bottom of the next (backfacing)

                index += this.verticesPerChar;
                x += spacing + charWidth;
            }

            y -= spacing + 2 * charHeight;
        }
    };


    SolariBoard.prototype.setMessage = function(msg) {
        /*
         * Setting the message builds a new character buffer. It's pushed to
         * the gpu inside the draw call.
         */
        var i, j, k, char, msgRow
          , self = this
          , bufIndex = 0
          , buffer = this.charBuffer
          , fillCharBuffer = function(to) {
                var i, from;
                // Repeat the from to character info for each vertex rendering that character
                for (i=0; i < self.verticesPerChar; i++) {
                    from = buffer[bufIndex + 2*i+1];
                    buffer[bufIndex + 2*i] = (Math.floor(to) < Math.floor(from)) ? from - self.chars.length : from;
                    buffer[bufIndex + 2*i+1] = to;
                }
                bufIndex += 2 * self.verticesPerChar;
          };

        for (j=0; j< this.rows; j++) {
            msgRow = (msg[j] || "").toUpperCase();
            for (i=0; i < this.cols; i++) {
                // for each character find it's index in our texture
                char = this.chars.length - 1;

                if (i < msgRow.length) {
                    k = this.chars.indexOf(msgRow[i]);
                    if (k!=-1) char = k;
                }

                fillCharBuffer(char + Math.random() * 0.1);
           }
        }
        this.charBufferDirty = true;
    };


    SolariBoard.prototype.update = function(time, gl) {
        if (this.timing < this.chars.length) {
            this.timing += time * this.speed;
        }

        if (this.charBufferDirty) {
            gl.bindBuffer(gl.ARRAY_BUFFER, this.charBufferObject);
            gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array(this.charBuffer));
            this.charBufferDirty = false;
        }
    };

    SolariBoard.prototype.draw = function(gl) {
        gl.drawElements(gl.TRIANGLES, this.numIndices, gl.UNSIGNED_SHORT, 0);
    };

    return SolariBoard;
});


