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


CREATE TABLE IF NOT EXISTS `callURLs` (
  `urlToken` varchar(30) NOT NULL,
  `userMac` varchar(64) NOT NULL,
  `callerId` varchar(255) DEFAULT '',
  `issuer` varchar(255) DEFAULT '',
  `timestamp` bigint(20) NOT NULL,
  `expires` bigint(20) NOT NULL,
  PRIMARY KEY (`urlToken`),
  KEY `callURLs_userMac` (`userMac`),
  KEY `callURLs_timestamp` (`timestamp`),
  KEY `callURLs_expires` (`expires`)
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
  `id` bigint(20) NOT NULL,
  `roomToken` varchar(30) NOT NULL,
  `hawkIdHmac` varchar(64) NOT NULL,
  `userMac` varchar(64) NOT NULL,
  `clientMaxSize` int(11) NOT NULL,
  `displayName` varchar(255) NOT NULL,
  `expiresIn` int(11) NOT NULL,
  `timestamp` bigint(20) NOT NULL,
  `expires` bigint(20) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `roomParticipant_roomToken` (`roomToken`),
  CONSTRAINT FOREIGN KEY (`roomToken`) REFERENCES `room` (`roomToken`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
