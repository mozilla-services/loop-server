-- create all tables

CREATE TABLE IF NOT EXISTS `simplePushURLs` (
  `hawkIdHmac` VARCHAR(64) NOT NULL,
  `userMac` VARCHAR(64) NOT NULL,
  `topics` TEXT NOT NULL,
  PRIMARY KEY (`hawkIdHmac`),
  KEY `simplePushURLs_userMac` (`userMac`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE IF NOT EXISTS `callURLs` (
  `urlToken` varchar(12) NOT NULL,
  `userMac` varchar(64) NOT NULL,
  `callerId` varchar(255) DEFAULT '',
  `timestamp` bigint(20) NOT NULL,
  `issuer` varchar(255) DEFAULT '',
  `expires` bigint(20) NOT NULL,
  PRIMARY KEY (`urlToken`),
  KEY `userMac` (`userMac`, `expires`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
