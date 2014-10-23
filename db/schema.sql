-- create all tables

CREATE TABLE IF NOT EXISTS `hawkSession` (
  `hawkIdHmac` VARCHAR(64) NOT NULL,
  `authKey` VARCHAR(64) NOT NULL,
  `userMac` VARCHAR(64),
  `encryptedUserId` text,
  `timestamp` bigint(20) NOT NULL,
  `expires` bigint(20) NOT NULL,
  PRIMARY KEY (`hawkIdHmac`),
  KEY `hawkSession_timestamp` (`timestamp`),
  KEY `hawkSession_expires` (`expires`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;


CREATE TABLE IF NOT EXISTS `sessionSPURLs` (
  `hawkIdHmac` VARCHAR(64) NOT NULL,
  `userMac` VARCHAR(64) NOT NULL,
  `topics` TEXT,
  `timestamp` bigint(20) NOT NULL,
  `expires` bigint(20) NOT NULL,
  PRIMARY KEY (`hawkIdHmac`),
  KEY `sessionSPURLs_userMac` (`userMac`),
  KEY `sessionSPURLs_timestamp` (`timestamp`),
  KEY `sessionSPURLs_expires` (`expires`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;


CREATE TABLE IF NOT EXISTS `callURL` (
  `urlToken` varchar(30) NOT NULL,
  `userMac` varchar(64) NOT NULL,
  `callerId` varchar(255) DEFAULT '',
  `issuer` varchar(255) DEFAULT '',
  `timestamp` bigint(20) NOT NULL,
  `expires` bigint(20) NOT NULL,
  PRIMARY KEY (`urlToken`),
  KEY `callURL_userMac` (`userMac`),
  KEY `callURL_timestamp` (`timestamp`),
  KEY `callURL_expires` (`expires`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;


CREATE TABLE IF NOT EXISTS `call` (
  `callId` varchar(36) NOT NULL,
  `userMac` varchar(64) NOT NULL,
  `callType` varchar(30) NOT NULL,
  `callState` varchar(30) NOT NULL,
  `callTerminationReason` varchar(30),
  `callerId` varchar(255),
  `calleeFriendlyName` varchar(255),
  `sessionId` varchar(255) NOT NULL,
  `apiKey` varchar(255) NOT NULL,
  `calleeToken` text NOT NULL,
  `wsCallerToken` varchar(255) NOT NULL,
  `wsCalleeToken` varchar(255) NOT NULL,
  `callToken` varchar(30),
  `urlCreationDate` bigint(20),
  `timestamp` bigint(20) NOT NULL,
  `expires` bigint(20) NOT NULL,
  PRIMARY KEY (`callId`),
  KEY `call_userMac` (`userMac`),
  KEY `call_timestamp` (`timestamp`),
  KEY `call_expires` (`expires`),
  CONSTRAINT FOREIGN KEY (`callToken`) REFERENCES `callURL` (`urlToken`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;


CREATE TABLE IF NOT EXISTS `room` (
  `roomToken` varchar(30) NOT NULL,
  `roomName` varchar(255) NOT NULL,
  `roomOwner` varchar(255) NOT NULL,
  `ownerMac` varchar(64) NOT NULL,
  `sessionId` varchar(255) NOT NULL,
  `apiKey` varchar(255) NOT NULL,
  `maxSize` int(11) NOT NULL,
  `expiresIn` bigint(20) NOT NULL,
  `creationTime` bigint(20) NOT NULL,
  `updateTime` bigint(20) NOT NULL,
  `expiresAt` bigint(20) NOT NULL,
  PRIMARY KEY (`roomToken`),
  KEY `room_userMac` (`ownerMac`),
  KEY `room_timestamp` (`creationTime`),
  KEY `room_expires` (`expiresAt`),
  KEY `room_updateTime` (`updateTime`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;


CREATE TABLE IF NOT EXISTS `roomParticipant` (
  `roomToken` varchar(30) NOT NULL,
  `hawkIdHmac` varchar(64) NOT NULL,
  `id` varchar(36) NOT NULL,
  `userMac` varchar(64) NOT NULL,
  `clientMaxSize` int(11) NOT NULL,
  `displayName` varchar(255) NOT NULL,
  `encryptedUserId` text,
  `expiresIn` int(11) NOT NULL,
  `timestamp` bigint(20) NOT NULL,
  `expires` bigint(20) NOT NULL,
  PRIMARY KEY (`roomToken`, `hawkIdHmac`),
  UNIQUE KEY `roomParticipant_id` (`id`),
  KEY `roomParticipant_roomToken` (`roomToken`),
  CONSTRAINT FOREIGN KEY (`roomToken`) REFERENCES `room` (`roomToken`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
