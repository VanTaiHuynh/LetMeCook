package com.server.letMeCook.model;


import java.util.UUID;

import org.hibernate.annotations.GenericGenerator;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

@Entity
@org.hibernate.annotations.BatchSize(size=50)
@Table(name = "users")
@Getter
@Setter
public class User {

    @Id
    @GeneratedValue
    @GenericGenerator(name="UUID",strategy = "org.hibernate.id.UUIDGenerator")
    @Column(name = "id", updatable = false, nullable = false)
    private UUID id;

    @Column(name="first_name")
    private String firstName = "";

    @Column(name = "last_name")
    private String lastName = "";


    @Column(name = "role")
    private String role = "user";

    @Column(name = "email", unique = true)
    private String email = "";

    @Column(name = "about_me", columnDefinition = "TEXT")
    private String aboutMe = "";

    @Column(name = "image_url")
    private String imageUrl = "";

    @Column(name = "cooking_skill")
    private String cookingLvl = "";

    @JdbcTypeCode(SqlTypes.ARRAY)
    @Column(name = "dietary_pref", columnDefinition = "text[]")
    private String[] dietaryPref = new String[0];


    public User() {    }
    public User(String email, String firstName, String lastName, String auth0Id, String role) {
        this.email = email;
        this.firstName = firstName;
        this.lastName = lastName;
        this.role = (role != null) ? role : "user";
    }
}
