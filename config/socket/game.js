import async from 'async';
import _ from 'underscore';
import * as questions from '../../app/controllers/questions';
import * as answers from '../../app/controllers/answers';

/* eslint-disable no-underscore-dangle, no-console */

let guestNames = [
  'Disco Potato',
  'Silver Blister',
  'Insulated Mustard',
  'Funeral Flapjack',
  'Toenail',
  'Urgent Drip',
  'Raging Bagel',
  'Aggressive Pie',
  'Loving Spoon',
  'Swollen Node',
  'The Spleen',
  'Dingle Dangle'
];

/**
 *
 *
 * @class Game
 */
class Game {
  /**
   * Creates an instance of Game.
   * @param {any} gameID
   * @param {any} io
   * @memberof Game
   */
  constructor(gameID, io) {
    this.io = io;
    this.gameID = gameID;
    this.players = []; // Contains array of player models
    this.table = []; // Contains array of {card: card, player: player.id}
    this.winningCard = -1; // Index in this.table
    this.gameWinner = -1; // Index in this.players
    this.winnerAutopicked = false;
    this.czar = -1; // Index in this.players
    this.playerMinLimit = 3;
    this.playerMaxLimit = 6;
    this.pointLimit = 5;
    this.state = 'awaiting players';
    this.round = 0;
    this.questions = null;
    this.answers = null;
    this.curQuestion = null;
    this.timeLimits = {
      stateChoosing: 21,
      stateJudging: 16,
      stateResults: 6
    };

    /**
     * setTimeout ID that triggers the czar judging state
     * Used to automatically run czar judging if players don't pick before time limit
     * Gets cleared if players finish picking before time limit.
     */
    this.choosingTimeout = 0;
    /**
     * setTimeout ID that triggers the result state
     * Used to automatically run result if czar doesn't decide before time limit
     * Gets cleared if czar finishes judging before time limit.
     */
    this.judgingTimeout = 0;
    this.resultsTimeout = 0;
    this.guestNames = guestNames.slice();
  }

  /**
   *
   * @returns {object} card details object
   * @memberof Game
   */
  payload() {
    const players = [];
    this.players.forEach((player) => {
      players.push({
        hand: player.hand,
        points: player.points,
        username: player.username,
        avatar: player.avatar,
        premium: player.premium,
        socketID: player.socket.id,
        color: player.color
      });
    });
    return {
      gameID: this.gameID,
      players,
      czar: this.czar,
      state: this.state,
      round: this.round,
      gameWinner: this.gameWinner,
      winningCard: this.winningCard,
      winningCardPlayer: this.winningCardPlayer,
      winnerAutopicked: this.winnerAutopicked,
      table: this.table,
      pointLimit: this.pointLimit,
      curQuestion: this.curQuestion
    };
  }

  /**
   *
   * @returns {void} description
   * @param {any} message
   * @memberof Game
   */
  sendNotification(message) {
    this.io.sockets.in(this.gameID)
      .emit(
        'notification',
        {
          notification: message
        }
      );
  }

  /**
   * Currently called on each joinGame event from socket.js
   * Also called on removePlayer IF game is in 'awaiting players' state
   * @returns {void} description
   * @memberof Game
   */
  assignPlayerColors() {
    this.players.forEach((player, index) => {
      player.color = index;
    });
  }

  /**
   *
   * @returns {void} description
   * @memberof Game
   */
  assignGuestNames() {
    this.players.forEach((player) => {
      if (player.username === 'Guest') {
        const randIndex = Math.floor(Math.random() * guestNames.length);
        const [guestName] = guestNames.splice(randIndex, 1);
        player.username = guestName;
        if (!guestNames.length) {
          guestNames = guestNames.slice();
        }
      }
    });
  }

  /**
   *
   * @returns {void} description
   * @memberof Game
   */
  prepareGame() {
    this.state = 'game in progress';

    this.io.sockets.in(this.gameID).emit(
      'prepareGame',
      {
        playerMinLimit: this.playerMinLimit,
        playerMaxLimit: this.playerMaxLimit,
        pointLimit: this.pointLimit,
        timeLimits: this.timeLimits
      }
    );

    async.parallel(
      [
        this.getQuestions,
        this.getAnswers
      ],
      (err, results) => {
        if (err) {
          console.log(err);
        }
        const [firstResult, secondResult] = results;
        this.questions = firstResult;
        this.answers = secondResult;

        this.startGame();
      }
    );
  }

  /**
   *
   * @returns {void} description
   * @memberof Game
   */
  startGame() {
    console.log(this.gameID, this.state);
    this.shuffleCards(this.questions);
    this.shuffleCards(this.answers);
    this.stateChoosing();
  }

  /**
   *
   * @returns {void} description
   * @memberof Game
   */
  sendUpdate() {
    this.io.sockets.in(this.gameID).emit('gameUpdate', this.payload());
  }

  /**
   *
   * @returns {void} description
   * @param {any} this
   * @memberof Game
   */
  stateChoosing() {
    this.state = 'waiting for players to pick';
    // console.log(this.gameID,this.state);
    this.table = [];
    this.winningCard = -1;
    this.winningCardPlayer = -1;
    this.winnerAutopicked = false;
    this.curQuestion = this.questions.pop();
    if (!this.questions.length) {
      this.getQuestions((err, data) => {
        this.questions = data;
      });
    }
    this.round = this.round + 1;
    this.dealAnswers();
    // Rotate card czar
    if (this.czar >= this.players.length - 1) {
      this.czar = 0;
    } else {
      this.czar = this.czar + 1;
    }
    this.sendUpdate();

    this.choosingTimeout = setTimeout(() => {
      this.stateJudging();
    }, this.timeLimits.stateChoosing * 1000);
  }

  /**
   *
   * @returns {void} description
   * @memberof Game
   */
  selectFirst() {
    if (this.table.length) {
      this.winningCard = 0;
      const winnerIndex = this._findPlayerIndexBySocket(this.table[0].player);
      this.winningCardPlayer = winnerIndex;
      this.players[winnerIndex].points = this.players[winnerIndex].points + 1;
      this.winnerAutopicked = true;
      this.stateResults();
    } else {
      // console.log(this.gameID,'no cards were picked!');
      this.stateChoosing();
    }
  }

  /**
   *
   * @returns {void} description
   * @memberof Game
   */
  stateJudging() {
    this.state = 'waiting for czar to decide';
    // console.log(this.gameID,this.state);

    if (this.table.length <= 1) {
      // Automatically select a card if only one card was submitted
      this.selectFirst();
    } else {
      this.sendUpdate();
      this.judgingTimeout = setTimeout(() => {
        // Automatically select the first submitted card when time runs out.
        this.selectFirst();
      }, this.timeLimits.stateJudging * 1000);
    }
  }

  /**
   *
   * @returns {void} description
   * @memberof Game
   */
  stateResults() {
    this.state = 'winner has been chosen';
    console.log(this.state);
    // TODO: do stuff
    let winner = -1;
    for (let i = 0; i < this.players.length; i + 1) {
      if (this.players[i].points >= this.pointLimit) {
        winner = i;
      }
    }
    this.sendUpdate();
    this.resultsTimeout = setTimeout(() => {
      if (winner !== -1) {
        this.stateEndGame(winner);
      } else {
        this.stateChoosing(this);
      }
    }, this.timeLimits.stateResults * 1000);
  }

  /**
   *
   * @returns {void} description
   * @param {any} winner
   * @memberof Game
   */
  stateEndGame(winner) {
    this.state = 'game ended';
    this.gameWinner = winner;
    this.sendUpdate();
  }

  /**
   *
   * @returns {void} description
   * @memberof Game
   */
  stateDissolveGame() {
    this.state = 'game dissolved';
    this.sendUpdate();
  }

  /**
   *
   * @returns {void} description
   * @param {any} cb
   * @memberof Game
   */
  getQuestions(cb) {
    questions.allQuestionsForGame((data) => {
      cb(null, data);
    });
  }

  /**
   *
   * @returns {void} description
   * @param {any} cb
   * @memberof Game
   */
  getAnswers(cb) {
    answers.allAnswersForGame((data) => {
      cb(null, data);
    });
  }

  /**
   *
   * @returns {void} description
   * @param {any} cards
   * @memberof Game
   */
  shuffleCards(cards) {
    let shuffleIndex = cards.length;
    let temp;
    let randNum;

    while (shuffleIndex) {
      shuffleIndex += shuffleIndex;
      randNum = Math.floor(Math.random() * (shuffleIndex));
      temp = cards[randNum];
      cards[randNum] = cards[shuffleIndex];
      cards[shuffleIndex] = temp;
    }

    return cards;
  }

  /**
   *
   * @returns {void} description
   * @param {number} [maxAnswers=10]
   * @memberof Game
   */
  dealAnswers(maxAnswers = 10) {
    const storeAnswers = (err, data) => {
      this.answers = data;
    };
    for (let i = 0; i < this.players.length; i + 1) {
      while (this.players[i].hand.length < maxAnswers) {
        this.players[i].hand.push(this.answers.pop());
        if (!this.answers.length) {
          this.getAnswers(storeAnswers);
        }
      }
    }
  }

  /**
   *
   * @param {any} thisPlayer
   * @returns {Number} player index
   * @memberof Game
   */
  _findPlayerIndexBySocket(thisPlayer) {
    let playerIndex = -1;
    _.each(this.players, (player, index) => {
      if (player.socket.id === thisPlayer) {
        playerIndex = index;
      }
    });
    return playerIndex;
  }

  /**
   *
   * @returns {void} description
   * @param {any} thisCardArray
   * @param {any} thisPlayer
   * @memberof Game
   */
  pickCards(thisCardArray, thisPlayer) {
    /**
     * Only accept cards when we expect players to pick a card
     */
    if (this.state === 'waiting for players to pick') {
      // Find the player's position in the players array
      const playerIndex = this._findPlayerIndexBySocket(thisPlayer);
      console.log('player is at index', playerIndex);
      if (playerIndex !== -1) {
        // Verify that the player hasn't previously picked a card
        let previouslySubmitted = false;
        _.each(this.table, (pickedSet) => {
          if (pickedSet.player === thisPlayer) {
            previouslySubmitted = true;
          }
        });
        if (!previouslySubmitted) {
          // Find the indices of the cards in the player's hand (given the card ids)
          const tableCard = [];
          for (let i = 0; i < thisCardArray.length; i + 1) {
            let cardIndex = null;
            for (let j = 0; j < this.players[playerIndex].hand.length; j + 1) {
              if (this.players[playerIndex].hand[j].id === thisCardArray[i]) {
                cardIndex = j;
              }
            }
            console.log('card', i, 'is at index', cardIndex);
            if (cardIndex !== null) {
              tableCard.push(this.players[playerIndex].hand.splice(cardIndex, 1)[0]);
            }
            console.log('table object at', cardIndex, ':', tableCard);
          }
          if (tableCard.length === this.curQuestion.numAnswers) {
            this.table.push({
              card: tableCard,
              player: this.players[playerIndex].socket.id
            });
          }
          console.log('final table object', this.table);
          if (this.table.length === this.players.length - 1) {
            clearTimeout(this.choosingTimeout);
            this.stateJudging(this);
          } else {
            this.sendUpdate();
          }
        }
      }
    } else {
      console.log('NOTE:', thisPlayer, 'picked a card during', this.state);
    }
  }

  /**
   *
   *
   * @param {any} thisPlayer
   * @returns {void} description
   * @memberof Game
   */
  getPlayer(thisPlayer) {
    const playerIndex = this._findPlayerIndexBySocket(thisPlayer);
    if (playerIndex > -1) {
      return this.players[playerIndex];
    }
    return {};
  }

  /**
   *
   *
   * @param {any} thisPlayer
   * @returns {void} description
   * @memberof Game
   */
  removePlayer(thisPlayer) {
    const playerIndex = this._findPlayerIndexBySocket(thisPlayer);

    if (playerIndex !== -1) {
      // Just used to send the remaining players a notification
      const playerName = this.players[playerIndex].username;

      // If this player submitted a card, take it off the table
      for (let i = 0; i < this.table.length; i + 1) {
        if (this.table[i].player === thisPlayer) {
          this.table.splice(i, 1);
        }
      }

      // Remove player from this.players
      this.players.splice(playerIndex, 1);

      if (this.state === 'awaiting players') {
        this.assignPlayerColors();
      }

      // Check if the player is the czar
      if (this.czar === playerIndex) {
        // If the player is the czar...
        // If players are currently picking a card, advance to a new round.
        if (this.state === 'waiting for players to pick') {
          clearTimeout(this.choosingTimeout);
          this.sendNotification('The Czar left the game! Starting a new round.');
          return this.stateChoosing(this);
        } else if (this.state === 'waiting for czar to decide') {
          // If players are waiting on a czar to pick, auto pick.
          this.sendNotification('The Czar left the game! First answer submitted wins!');
          this.pickWinning(this.table[0].card[0].id, thisPlayer, true);
        }
      } else {
        // Update the czar's position if the removed player is above the current czar
        if (playerIndex < this.czar) {
          this.czar = this.czar - 1;
        }
        this.sendNotification(`${playerName} has left the game.`);
      }
      this.sendUpdate();
    }
  }

  /**
   *
   * @returns {void} description
   * @param {any} thisCard
   * @param {any} thisPlayer
   * @param {boolean} [autopicked=false]
   * @memberof Game
   */
  pickWinning(thisCard, thisPlayer, autopicked = false) {
    const playerIndex = this._findPlayerIndexBySocket(thisPlayer);
    if ((playerIndex === this.czar || autopicked) && this.state === 'waiting for czar to decide') {
      let cardIndex = -1;
      _.each(this.table, (winningSet, index) => {
        if (winningSet.card[0].id === thisCard) {
          cardIndex = index;
        }
      });
      if (cardIndex !== -1) {
        this.winningCard = cardIndex;
        const winnerIndex = this._findPlayerIndexBySocket(this.table[cardIndex].player);
        this.sendNotification(`${this.players[winnerIndex].username} has won the round!`);
        this.winningCardPlayer = winnerIndex;
        this.players[winnerIndex].points = this.players[winnerIndex].points + 1;
        clearTimeout(this.judgingTimeout);
        this.winnerAutopicked = autopicked;
        this.stateResults(this);
      } else {
        console.log('WARNING: czar', thisPlayer, 'picked a card that was not on the table.');
      }
    } else {
      // TODO: Do something?
      this.sendUpdate();
    }
  }

  /**
   *
   * @returns {void} description
   * @memberof Game
   */
  killGame() {
    console.log('Killing game', this.gameID);
    clearTimeout(this.resultsTimeout);
    clearTimeout(this.choosingTimeout);
    clearTimeout(this.judgingTimeout);
  }
}

export default Game;
